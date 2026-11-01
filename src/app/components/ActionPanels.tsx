'use client'

import { toast } from 'react-hot-toast';
import { bookSurgery, triggerEmergency } from '../actions';
import { useRef, useState, useTransition } from 'react';
import type { StaffMember, OperatingTheater } from '../lib/types';

// ── Types ──────────────────────────────────────────────────────────────────────
type StaffRow = { id: string; staffCode: string; role: string };
type AssetRow = { id: string; assetId: string };

const uid = () => Math.random().toString(36).slice(2, 8);

const inputCls = 'w-full bg-stone-100 border border-transparent rounded-xl px-4 py-3 text-sm font-medium text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-300 transition-all';
const labelCls = 'block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 ml-0.5';
const selectCls = 'w-full bg-stone-100 border border-transparent rounded-xl px-3 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-300 transition-all appearance-none cursor-pointer';
const addBtnCls = 'inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-900 border border-teal-200 hover:border-teal-400 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-all';
const removeBtnCls = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-rose-100 text-stone-400 hover:text-rose-600 transition-colors text-base leading-none border border-transparent hover:border-rose-200';

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-stone-100" />
      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="h-px flex-1 bg-stone-100" />
    </div>
  );
}

function StaffRowInput({
  row,
  index,
  canRemove,
  staffList,
  availableRoles,
  onUpdate,
  onRemove,
}: {
  row: StaffRow;
  index: number;
  canRemove: boolean;
  staffList: StaffMember[];
  availableRoles: string[];
  onUpdate: (id: string, field: keyof Omit<StaffRow, 'id'>, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const filteredStaff = staffList.filter((s) => s.medical_role === row.role);

  function handleRoleChange(newRole: string) {
    onUpdate(row.id, 'role', newRole);
    onUpdate(row.id, 'staffCode', '');
  }

  return (
    <div className="flex gap-2 items-start">
      <select
        name="staffRole"
        value={row.role}
        onChange={(e) => handleRoleChange(e.target.value)}
        className="flex-[1.1] bg-stone-100 border border-transparent rounded-xl px-3 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-300 transition-all appearance-none cursor-pointer"
      >
        {availableRoles.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      <select
        name="staffCode"
        value={row.staffCode}
        onChange={(e) => onUpdate(row.id, 'staffCode', e.target.value)}
        className={`flex-[1.5] ${selectCls}`}
        required
      >
        <option value="" disabled>
          {filteredStaff.length === 0 ? `No ${row.role} on record` : `Select ${row.role}…`}
        </option>
        {filteredStaff.map((s) => (
          <option key={s.staff_id} value={s.staff_code}>
            {s.staff_code} — {s.first_name} {s.last_name}
          </option>
        ))}
      </select>

      {canRemove && (
        <button type="button" onClick={() => onRemove(row.id)} className={removeBtnCls}>×</button>
      )}
    </div>
  );
}

function AssetRowInput({
  row,
  index,
  canRemove,
  onUpdate,
  onRemove,
}: {
  row: AssetRow;
  index: number;
  canRemove: boolean;
  onUpdate: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 items-center">
      <input
        type="number"
        name="assetId"
        placeholder={`Asset ID ${index + 1}`}
        value={row.assetId}
        onChange={(e) => onUpdate(row.id, e.target.value)}
        className="flex-1 bg-stone-100 border border-transparent rounded-xl px-4 py-3 text-sm font-medium text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-300 transition-all tabular-nums"
        min={1}
      />
      {canRemove && (
        <button type="button" onClick={() => onRemove(row.id)} className={removeBtnCls}>×</button>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ActionPanels({ staffList, branchOts }: { staffList: StaffMember[]; branchOts: OperatingTheater[]; }) {
  const bookingFormRef = useRef<HTMLFormElement>(null);
  const emergencyFormRef = useRef<HTMLFormElement>(null);
  const [isBookingPending, startBookingTransition] = useTransition();
  const [isEmergencyPending, startEmergencyTransition] = useTransition();

  // Dynamically calculate available roles from the database payload
  const availableRoles = Array.from(new Set(staffList.map((s) => s.medical_role))).sort();
  const defaultRole = availableRoles.length > 0 ? availableRoles[0] : '';

  const [staffRows, setStaffRows] = useState<StaffRow[]>([
    { id: uid(), staffCode: '', role: defaultRole },
  ]);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([{ id: uid(), assetId: '' }]);

  function handleBooking(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startBookingTransition(async () => {
      toast.loading('Booking surgery...', { id: 'booking' });
      const result = await bookSurgery(formData);
      if (!result.success) {
        toast.error(`Blocked: ${result.error}`, { id: 'booking' });
      } else {
        toast.success(`Surgery booked — ID #${result.bookingId}`, { id: 'booking' });
        bookingFormRef.current?.reset();
        setStaffRows([{ id: uid(), staffCode: '', role: defaultRole }]);
        setAssetRows([{ id: uid(), assetId: '' }]);
      }
    });
  }

  function handleEmergency(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startEmergencyTransition(async () => {
      toast.loading('Initiating override...', { id: 'emergency' });
      const result = await triggerEmergency(formData);
      if (!result.success) {
        toast.error(`Failed: ${result.error}`, { id: 'emergency' });
      } else {
        toast.success(`Emergency override active — Booking #${result.bookingId}`, { id: 'emergency' });
        emergencyFormRef.current?.reset();
      }
    });
  }

  const addStaffRow = () => setStaffRows((r) => [...r, { id: uid(), staffCode: '', role: defaultRole }]);
  const removeStaffRow = (id: string) => setStaffRows((r) => r.filter((row) => row.id !== id));
  const updateStaff = (id: string, field: keyof Omit<StaffRow, 'id'>, value: string) =>
    setStaffRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  const addAssetRow = () => setAssetRows((r) => [...r, { id: uid(), assetId: '' }]);
  const removeAssetRow = (id: string) => setAssetRows((r) => r.filter((row) => row.id !== id));
  const updateAsset = (id: string, value: string) =>
    setAssetRows((r) => r.map((row) => (row.id === id ? { ...row, assetId: value } : row)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      {/* ════════════════ Schedule Surgery ════════════════ */}
      <section className="bg-white rounded-[2rem] shadow-sm border border-stone-100 overflow-hidden flex flex-col">
        <div className="px-8 py-5 border-b border-stone-100 bg-stone-50/60 shrink-0">
          <h2 className="font-bold text-stone-800 text-lg">Schedule Surgery</h2>
          <p className="text-xs text-stone-400 mt-0.5">Create a new booking with staff and equipment allocation.</p>
        </div>

        <form ref={bookingFormRef} onSubmit={handleBooking} className="p-8 space-y-5 flex-1">
          <div>
            <label className={labelCls}>Patient ID</label>
            <input type="number" name="patientId" placeholder="e.g. 1042" className={inputCls} required min={1} />
          </div>

          <div>
            <label className={labelCls}>Operating Theater</label>
            {branchOts.length === 0 ? (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs font-medium text-amber-700">No operating theaters configured for this branch.</div>
            ) : (
              <select name="otId" className={selectCls} required defaultValue="">
                <option value="" disabled>Select an OT…</option>
                {branchOts.map((ot) => (
                  <option key={ot.ot_id} value={ot.ot_id}>{ot.room_number} — {ot.ot_specialty} (OT #{ot.ot_id})</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className={labelCls}>Scheduled Start</label>
            <input type="datetime-local" name="scheduledStart" className={inputCls} required />
          </div>

          <SectionDivider label="Staff Assignment" />
          <div className="bg-stone-50/70 border border-stone-100 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Assign Team Members</p>
              <button type="button" onClick={addStaffRow} className={addBtnCls}>Add Staff</button>
            </div>
            {staffRows.map((row, idx) => (
              <StaffRowInput
                key={row.id}
                row={row}
                index={idx}
                canRemove={staffRows.length > 1}
                staffList={staffList}
                availableRoles={availableRoles}
                onUpdate={updateStaff}
                onRemove={removeStaffRow}
              />
            ))}
          </div>

          <SectionDivider label="Equipment Allocation" />
          <div className="bg-stone-50/70 border border-stone-100 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Allocate Surgical Assets</p>
              <button type="button" onClick={addAssetRow} className={addBtnCls}>Add Asset</button>
            </div>
            {assetRows.map((row, idx) => (
              <AssetRowInput
                key={row.id}
                row={row}
                index={idx}
                canRemove={assetRows.length > 1}
                onUpdate={updateAsset}
                onRemove={removeAssetRow}
              />
            ))}
          </div>

          <button type="submit" disabled={isBookingPending} className="w-full bg-teal-800 hover:bg-teal-900 disabled:bg-teal-800/60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-2xl transition-all text-sm tracking-wide mt-1">
            {isBookingPending ? 'Booking...' : 'Confirm Booking'}
          </button>
        </form>
      </section>

      {/* ════════════════ Emergency Override ════════════════ */}
      <section className="bg-white rounded-[2rem] shadow-sm border border-rose-100 overflow-hidden flex flex-col">
        <div className="px-8 py-5 border-b border-rose-100 bg-rose-50/40 shrink-0">
          <h2 className="font-bold text-rose-900 text-lg flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />Emergency Override
          </h2>
          <p className="text-xs text-rose-400 mt-0.5">Bump an elective booking to free the target OT immediately.</p>
        </div>

        <form ref={emergencyFormRef} onSubmit={handleEmergency} className="p-8 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-rose-700/70 uppercase tracking-wider mb-1.5 ml-0.5">Target OT</label>
              {branchOts.length === 0 ? (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs font-medium text-amber-700">No OTs available.</div>
              ) : (
                <select name="targetOtId" className="w-full bg-stone-100 border border-transparent rounded-xl px-3 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-300 transition-all appearance-none cursor-pointer" required defaultValue="">
                  <option value="" disabled>Select target OT…</option>
                  {branchOts.map((ot) => (
                    <option key={ot.ot_id} value={ot.ot_id}>OT #{ot.ot_id} — {ot.room_number}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-rose-700/70 uppercase tracking-wider mb-1.5 ml-0.5">Conflict Booking ID</label>
              <input type="number" name="conflictBookingId" className="w-full bg-stone-100 border border-transparent rounded-xl px-4 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-300 transition-all" required min={1} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-rose-700/70 uppercase tracking-wider mb-1.5 ml-0.5">Patient ID</label>
              <input type="number" name="patientId" className="w-full bg-stone-100 border border-transparent rounded-xl px-4 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-300 transition-all" required min={1} />
            </div>
            <div>
              <label className="block text-xs font-bold text-rose-700/70 uppercase tracking-wider mb-1.5 ml-0.5">Scheduled Start</label>
              <input type="datetime-local" name="scheduledStart" className="w-full bg-stone-100 border border-transparent rounded-xl px-4 py-3 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-300 transition-all" required />
            </div>
          </div>

          <SectionDivider label="Emergency Responder Assignment" />
          <div className="bg-rose-50/50 border border-rose-100 rounded-2xl p-4 space-y-3">
            {staffRows.map((row, idx) => (
              <StaffRowInput
                key={row.id}
                row={row}
                index={idx}
                canRemove={false}
                staffList={staffList}
                availableRoles={availableRoles}
                onUpdate={updateStaff}
                onRemove={removeStaffRow}
              />
            ))}
          </div>

          <button type="submit" disabled={isEmergencyPending} className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-rose-600/60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-2xl transition-all text-sm tracking-wide mt-auto">
            {isEmergencyPending ? 'Initiating Override...' : 'Initiate Override Cascade'}
          </button>
        </form>
      </section>
    </div>
  );
}