'use server'

import { supabase } from './lib/supabase';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pull every `name[]` multi-value field out of FormData into a string array. */
function getAll(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((v) => String(v).trim()).filter(Boolean);
}

/** Read the logged-in branch_id from the session cookie. Returns 0 if absent. */
async function getSessionBranchId(): Promise<number> {
  const cookieStore = await cookies();
  return Number(cookieStore.get('branch_id')?.value ?? 0);
}

// ─── Auth: Login ───────────────────────────────────────────────────────────────
//
// Verifies credentials against hospital_branch (branch_username, branch_password).
// On success, stores branch_id in an httpOnly session cookie and redirects.
//
export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();

  if (!username || !password) {
    return { success: false, error: 'Both username and password are required.' };
  }

  const { data: branch, error } = await supabase
    .from('hospital_branch')
    .select('branch_id, branch_name')
    .eq('branch_username', username)
    .eq('branch_password', password)
    .single();

  if (error || !branch) {
    return { success: false, error: 'Invalid credentials. Please check your username and password.' };
  }

  // Establish session cookie — httpOnly so JS cannot read it securely
  const cookieStore = await cookies();
  cookieStore.set('branch_id', String(branch.branch_id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8-hour session
  });

  redirect('/dashboard');
}

// ─── Auth: Logout ──────────────────────────────────────────────────────────────

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete('branch_id');
  redirect('/');
}

// ─── Action 1: Book Surgery ────────────────────────────────────────────────────
//
// 3-step workflow:
//   Step 0 → Server-side guard: verify OT belongs to the logged-in branch
//   Step 1 → INSERT into surgery_booking, capture booking_id
//   Step 2 → Map staff_codes → staff_ids, INSERT into booking_staff_assignment
//   Step 3 → INSERT into booking_asset_allocation
//
export async function bookSurgery(formData: FormData) {
  const branchId = await getSessionBranchId();
  if (!branchId) return { success: false, error: 'Session expired. Please log in again.' };

  // ── Parse core fields ────────────────────────────────────────────────────────
  const patientId = Number(formData.get('patientId'));
  const otId = Number(formData.get('otId'));
  const scheduledStart = String(formData.get('scheduledStart'));

  if (!patientId || !otId || !scheduledStart) {
    return { success: false, error: 'Patient ID, OT ID, and Scheduled Start are required.' };
  }

  // ── Step 0: Guard — OT must belong to the logged-in branch ────────────────
  const { data: otCheck } = await supabase
    .from('operating_theater')
    .select('ot_id')
    .eq('ot_id', otId)
    .eq('branch_id', branchId)
    .single();

  if (!otCheck) {
    return { success: false, error: 'Security Error: The selected OT does not belong to your hospital branch.' };
  }

  // ── Parse staff codes + roles (parallel arrays) ──────────────────────────
  // The form submits staff_code[] values (e.g., '01', '02') as the "business" IDs.
  // We map these back to internal staff_id integers before inserting.
  const staffCodes = getAll(formData, 'staffCode');
  const rawRoles = getAll(formData, 'staffRole');
  const staffRoles = rawRoles.slice(0, staffCodes.length);

  // ── Parse asset IDs ────────────────────────────────────────────────────────
  const rawAssetIds = getAll(formData, 'assetId');
  const assetIds = rawAssetIds.map(Number).filter((n) => !isNaN(n) && n > 0);

  // ── Step 1: Insert the primary booking record ──────────────────────────────
  const { data: booking, error: bookingError } = await supabase
    .from('surgery_booking')
    .insert({
      patient_id: patientId,
      ot_id: otId,
      scheduled_start: new Date(scheduledStart).toISOString(),
      booking_status: 'Scheduled',
    })
    .select('booking_id')
    .single();

  if (bookingError || !booking) {
    // Postgres 23505 = unique_violation (duplicate ot_id + scheduled_start)
    if (bookingError?.code === '23505') {
      return {
        success: false,
        error: 'This Operating Theater is already booked at this specific time. Please choose a different time slot.',
      };
    }
    return {
      success: false,
      error: bookingError?.message ?? 'Failed to create surgery booking.',
    };
  }

  const bookingId = booking.booking_id;

  // ── Step 2: Map staff_codes → staff_ids, then insert assignments ───────────
  if (staffCodes.length > 0) {
    const { data: staffMembers, error: staffLookupError } = await supabase
      .from('staff')
      .select('staff_id, staff_code')
      .in('staff_code', staffCodes);

    if (staffLookupError || !staffMembers?.length) {
      return {
        success: false,
        error: `Booking #${bookingId} created but staff lookup failed: no matching staff codes found.`,
      };
    }

    const codeToId = new Map(staffMembers.map((s) => [s.staff_code, s.staff_id]));

    const staffRows = staffCodes
      .map((code, i) => ({
        booking_id: bookingId,
        staff_id: codeToId.get(code),
        assigned_role: staffRoles[i] ?? 'Unspecified',
      }))
      .filter((row) => row.staff_id !== undefined) as {
        booking_id: number;
        staff_id: number;
        assigned_role: string;
      }[];

    const { error: staffError } = await supabase
      .from('booking_staff_assignment')
      .insert(staffRows);

    if (staffError) {
      return {
        success: false,
        error: `Booking #${bookingId} created but staff assignment failed: ${staffError.message}`,
      };
    }
  }

  // ── Step 3: Insert asset allocations ──────────────────────────────────────
  if (assetIds.length > 0) {
    const allocationStart = new Date(scheduledStart).toISOString();

    const assetRows = assetIds.map((assetId) => ({
      booking_id: bookingId,
      asset_id: assetId,
      allocation_start: allocationStart,
    }));

    const { error: assetError } = await supabase
      .from('booking_asset_allocation')
      .insert(assetRows);

    if (assetError) {
      return {
        success: false,
        error: `Booking #${bookingId} created but asset allocation failed: ${assetError.message}`,
      };
    }
  }

  revalidatePath('/dashboard');
  return { success: true, bookingId };
}

// ─── Action 2: Trigger Emergency Override ──────────────────────────────────────
//
// 5-step workflow:
//   Step 0 → Server-side guard: verify target OT belongs to logged-in branch
//   Step 1 → Bump conflicting booking to 'Rescheduled (Emergency)'
//   Step 2 → INSERT emergency booking
//   Step 3 → Map staff_codes → staff_ids, INSERT staff assignments
//   Step 4 → INSERT asset allocations
//
export async function triggerEmergency(formData: FormData) {
  const branchId = await getSessionBranchId();
  if (!branchId) return { success: false, error: 'Session expired. Please log in again.' };

  const targetOtId = Number(formData.get('targetOtId'));
  const conflictBookingId = Number(formData.get('conflictBookingId'));
  const patientId = Number(formData.get('patientId'));
  const scheduledStart = String(formData.get('scheduledStart'));

  if (!targetOtId || !conflictBookingId || !patientId || !scheduledStart) {
    return { success: false, error: 'All emergency fields are required.' };
  }

  // ── Step 0: Guard — Target OT must belong to the logged-in branch ─────────
  const { data: otCheck } = await supabase
    .from('operating_theater')
    .select('ot_id')
    .eq('ot_id', targetOtId)
    .eq('branch_id', branchId)
    .single();

  if (!otCheck) {
    return { success: false, error: 'Security Error: You cannot initiate an emergency override for an OT outside your branch.' };
  }

  // Optional staff/asset overrides
  const staffCodes = getAll(formData, 'staffCode');
  const rawRoles = getAll(formData, 'staffRole');
  const staffRoles = rawRoles.slice(0, staffCodes.length);

  const rawAssetIds = getAll(formData, 'assetId');
  const assetIds = rawAssetIds.map(Number).filter((n) => !isNaN(n) && n > 0);

  // ── Step 1: Bump the conflicting booking to 'Rescheduled (Emergency)' ─────
  const { error: rescheduleError } = await supabase
    .from('surgery_booking')
    .update({ booking_status: 'Rescheduled (Emergency)' })
    .eq('booking_id', conflictBookingId);

  if (rescheduleError) {
    return {
      success: false,
      error: `Could not reschedule conflict booking #${conflictBookingId}: ${rescheduleError.message}`,
    };
  }

  // ── Step 2: Insert the emergency booking record ────────────────────────────
  const { data: emergencyBooking, error: bookingError } = await supabase
    .from('surgery_booking')
    .insert({
      patient_id: patientId,
      ot_id: targetOtId,
      scheduled_start: new Date(scheduledStart).toISOString(),
      booking_status: 'Emergency',
    })
    .select('booking_id')
    .single();

  if (bookingError || !emergencyBooking) {
    return {
      success: false,
      error: bookingError?.message ?? 'Failed to create emergency booking.',
    };
  }

  const emergencyBookingId = emergencyBooking.booking_id;

  // ── Step 3: Map staff_codes → staff_ids, insert assignments ───────────────
  if (staffCodes.length > 0) {
    const { data: staffMembers, error: staffLookupError } = await supabase
      .from('staff')
      .select('staff_id, staff_code')
      .in('staff_code', staffCodes);

    if (staffLookupError || !staffMembers?.length) {
      return {
        success: false,
        error: `Emergency booking #${emergencyBookingId} created but staff lookup failed.`,
      };
    }

    const codeToId = new Map(staffMembers.map((s) => [s.staff_code, s.staff_id]));

    const staffRows = staffCodes
      .map((code, i) => ({
        booking_id: emergencyBookingId,
        staff_id: codeToId.get(code),
        assigned_role: staffRoles[i] ?? 'Emergency Responder',
      }))
      .filter((row) => row.staff_id !== undefined) as {
        booking_id: number;
        staff_id: number;
        assigned_role: string;
      }[];

    const { error: staffError } = await supabase
      .from('booking_staff_assignment')
      .insert(staffRows);

    if (staffError) {
      return {
        success: false,
        error: `Emergency booking #${emergencyBookingId} created but staff assignment failed: ${staffError.message}`,
      };
    }
  }

  // ── Step 4: Insert asset allocations ──────────────────────────────────────
  if (assetIds.length > 0) {
    const allocationStart = new Date(scheduledStart).toISOString();

    const assetRows = assetIds.map((assetId) => ({
      booking_id: emergencyBookingId,
      asset_id: assetId,
      allocation_start: allocationStart,
    }));

    const { error: assetError } = await supabase
      .from('booking_asset_allocation')
      .insert(assetRows);

    if (assetError) {
      return {
        success: false,
        error: `Emergency booking #${emergencyBookingId} created but asset allocation failed: ${assetError.message}`,
      };
    }
  }

  revalidatePath('/dashboard');
  return { success: true, bookingId: emergencyBookingId };
}
