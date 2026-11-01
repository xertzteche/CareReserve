'use server'

import { supabase } from './lib/supabase';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAll(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((v) => String(v).trim()).filter(Boolean);
}

async function getSessionBranchId(): Promise<number> {
  const cookieStore = await cookies();
  return Number(cookieStore.get('branch_id')?.value ?? 0);
}

// ─── Auth ───────────────────────────────────────────────────────────────
export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();

  if (!username || !password) return { success: false, error: 'Both username and password are required.' };

  const { data: branch, error } = await supabase
    .from('hospital_branch')
    .select('branch_id, branch_name')
    .eq('branch_username', username)
    .eq('branch_password', password)
    .single();

  if (error || !branch) return { success: false, error: 'Invalid credentials. Please check your username and password.' };

  const cookieStore = await cookies();
  cookieStore.set('branch_id', String(branch.branch_id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  redirect('/dashboard');
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete('branch_id');
  redirect('/');
}

// ─── Guard Helper: Prevent Staff Double-Booking ────────────────────────────────
async function verifyStaffAvailability(staffCodes: string[], scheduledStart: string) {
  if (staffCodes.length === 0) return { success: true, codeToId: new Map<string, number>() };

  const { data: staffMembers, error: staffLookupError } = await supabase
    .from('staff')
    .select('staff_id, staff_code')
    .in('staff_code', staffCodes);

  if (staffLookupError || !staffMembers?.length) {
    return { success: false, error: 'Staff lookup failed: Invalid staff codes provided.' };
  }

  const codeToId = new Map(staffMembers.map((s) => [s.staff_code, s.staff_id]));
  const requestedStaffIds = staffMembers.map((s) => s.staff_id);

  const { data: conflictingBookings } = await supabase
    .from('surgery_booking')
    .select('booking_id')
    .in('booking_status', ['Scheduled', 'Emergency'])
    .eq('scheduled_start', new Date(scheduledStart).toISOString());

  if (conflictingBookings && conflictingBookings.length > 0) {
    const conflictBookingIds = conflictingBookings.map(b => b.booking_id);
    const { data: staffConflicts } = await supabase
      .from('booking_staff_assignment')
      .select('staff_id')
      .in('booking_id', conflictBookingIds)
      .in('staff_id', requestedStaffIds);

    if (staffConflicts && staffConflicts.length > 0) {
      return { success: false, error: 'Scheduling Conflict: One or more selected staff members are already assigned to an active surgery at this exact time.' };
    }
  }

  return { success: true, codeToId };
}

// ─── Guard Helper: Prevent Asset Overbooking ──────────────────────────────────
async function verifyAssetAvailability(assetIds: number[], scheduledStart: string) {
  if (assetIds.length === 0) return { success: true };

  const { data: assets, error: assetLookupError } = await supabase
    .from('surgical_asset')
    .select('asset_id, asset_name, total_quantity, sterilization_status')
    .in('asset_id', assetIds);

  if (assetLookupError || !assets?.length) {
    return { success: false, error: 'Asset lookup failed: Invalid assets requested.' };
  }

  const unavailableAsset = assets.find(a => a.sterilization_status !== 'Ready');
  if (unavailableAsset) {
    return { success: false, error: `Asset Conflict: ${unavailableAsset.asset_name} is currently marked as '${unavailableAsset.sterilization_status}' and cannot be booked.` };
  }

  const { data: conflictingBookings } = await supabase
    .from('surgery_booking')
    .select('booking_id')
    .in('booking_status', ['Scheduled', 'Emergency'])
    .eq('scheduled_start', new Date(scheduledStart).toISOString());

  if (conflictingBookings && conflictingBookings.length > 0) {
    const conflictBookingIds = conflictingBookings.map(b => b.booking_id);

    const { data: activeAllocations } = await supabase
      .from('booking_asset_allocation')
      .select('asset_id')
      .in('booking_id', conflictBookingIds)
      .in('asset_id', assetIds);

    if (activeAllocations) {
      for (const reqAsset of assets) {
        const currentlyInUseCount = activeAllocations.filter(a => a.asset_id === reqAsset.asset_id).length;
        if (currentlyInUseCount >= reqAsset.total_quantity) {
          return { success: false, error: `Inventory Depleted: All ${reqAsset.total_quantity} units of ${reqAsset.asset_name} are already booked for surgeries at this exact time.` };
        }
      }
    }
  }

  return { success: true };
}

// ─── Action 1: Book Surgery ────────────────────────────────────────────────────
export async function bookSurgery(formData: FormData) {
  const branchId = await getSessionBranchId();
  if (!branchId) return { success: false, error: 'Session expired. Please log in again.' };

  const patientId = Number(formData.get('patientId'));
  const otId = Number(formData.get('otId'));
  const scheduledStart = String(formData.get('scheduledStart'));

  if (!patientId || !otId || !scheduledStart) return { success: false, error: 'Patient ID, OT ID, and Scheduled Start are required.' };

  const { data: otCheck } = await supabase
    .from('operating_theater')
    .select('ot_id')
    .eq('ot_id', otId)
    .eq('branch_id', branchId)
    .single();

  if (!otCheck) return { success: false, error: 'Security Error: The selected OT does not belong to your hospital branch.' };

  const staffCodes = getAll(formData, 'staffCode');
  const rawRoles = getAll(formData, 'staffRole');
  const staffRoles = rawRoles.slice(0, staffCodes.length);
  const rawAssetIds = getAll(formData, 'assetId');
  const assetIds = rawAssetIds.map(Number).filter((n) => !isNaN(n) && n > 0);

  // Guard 2: Staff Concurrency Check
  const staffCheck = await verifyStaffAvailability(staffCodes, scheduledStart);
  if (!staffCheck.success) return { success: false, error: staffCheck.error };

  // Guard 3: Asset Inventory & Concurrency Check
  const assetCheck = await verifyAssetAvailability(assetIds, scheduledStart);
  if (!assetCheck.success) return { success: false, error: assetCheck.error };

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
    if (bookingError?.code === '23505') {
      return { success: false, error: 'This Operating Theater is already booked at this specific time.' };
    }
    return { success: false, error: bookingError?.message ?? 'Failed to create surgery booking.' };
  }

  const bookingId = booking.booking_id;

  if (staffCodes.length > 0 && staffCheck.codeToId) {
    const staffRows = staffCodes
      .map((code, i) => ({
        booking_id: bookingId,
        staff_id: staffCheck.codeToId!.get(code),
        assigned_role: staffRoles[i] ?? 'Unspecified',
      }))
      .filter((row) => row.staff_id !== undefined) as { booking_id: number; staff_id: number; assigned_role: string; }[];

    await supabase.from('booking_staff_assignment').insert(staffRows);
  }

  if (assetIds.length > 0) {
    const allocationStart = new Date(scheduledStart).toISOString();
    const assetRows = assetIds.map((assetId) => ({
      booking_id: bookingId,
      asset_id: assetId,
      allocation_start: allocationStart,
    }));
    await supabase.from('booking_asset_allocation').insert(assetRows);
  }

  revalidatePath('/dashboard');
  return { success: true, bookingId };
}

// ─── Action 2: Trigger Emergency Override ──────────────────────────────────────
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

  const { data: otCheck } = await supabase
    .from('operating_theater')
    .select('ot_id')
    .eq('ot_id', targetOtId)
    .eq('branch_id', branchId)
    .single();

  if (!otCheck) return { success: false, error: 'Security Error: You cannot initiate an emergency override for an OT outside your branch.' };

  const staffCodes = getAll(formData, 'staffCode');
  const rawRoles = getAll(formData, 'staffRole');
  const staffRoles = rawRoles.slice(0, staffCodes.length);
  const rawAssetIds = getAll(formData, 'assetId');
  const assetIds = rawAssetIds.map(Number).filter((n) => !isNaN(n) && n > 0);

  // Guard 2: Staff Concurrency Check
  const staffCheck = await verifyStaffAvailability(staffCodes, scheduledStart);
  if (!staffCheck.success) return { success: false, error: staffCheck.error };

  // Guard 3: Asset Inventory & Concurrency Check
  const assetCheck = await verifyAssetAvailability(assetIds, scheduledStart);
  if (!assetCheck.success) return { success: false, error: assetCheck.error };

  const { error: rescheduleError } = await supabase
    .from('surgery_booking')
    .update({ booking_status: 'Rescheduled (Emergency)' })
    .eq('booking_id', conflictBookingId);

  if (rescheduleError) return { success: false, error: `Could not reschedule conflict booking #${conflictBookingId}: ${rescheduleError.message}` };

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

  if (bookingError || !emergencyBooking) return { success: false, error: bookingError?.message ?? 'Failed to create emergency booking.' };

  const emergencyBookingId = emergencyBooking.booking_id;

  if (staffCodes.length > 0 && staffCheck.codeToId) {
    const staffRows = staffCodes
      .map((code, i) => ({
        booking_id: emergencyBookingId,
        staff_id: staffCheck.codeToId!.get(code),
        assigned_role: staffRoles[i] ?? 'Emergency Responder',
      }))
      .filter((row) => row.staff_id !== undefined) as { booking_id: number; staff_id: number; assigned_role: string; }[];

    await supabase.from('booking_staff_assignment').insert(staffRows);
  }

  if (assetIds.length > 0) {
    const allocationStart = new Date(scheduledStart).toISOString();
    const assetRows = assetIds.map((assetId) => ({
      booking_id: emergencyBookingId,
      asset_id: assetId,
      allocation_start: allocationStart,
    }));
    await supabase.from('booking_asset_allocation').insert(assetRows);
  }

  revalidatePath('/dashboard');
  return { success: true, bookingId: emergencyBookingId };
}