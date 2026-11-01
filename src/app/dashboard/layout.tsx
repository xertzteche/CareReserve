import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// ── Auth guard ─────────────────────────────────────────────────────────────────
// The docs recommend doing auth checks close to the data/component rather than
// solely in a layout (layouts don't re-render on client navigation, so a check
// in the layout alone can be bypassed). We check here as a first layer; each
// page within /dashboard also reads the cookie directly.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const branchId = cookieStore.get('branch_id')?.value;

  if (!branchId) {
    redirect('/');
  }

  return <>{children}</>;
}

