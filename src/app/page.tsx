import LoginForm from './components/LoginForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* ── Brand header ── */}
        <div className="bg-teal-900 text-white rounded-[2rem] p-8 mb-4 relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-teal-300 text-xs font-bold uppercase tracking-widest mb-2">
              Hospital Resource Allocation
            </p>
            <h1 className="text-3xl font-bold tracking-tight mb-1">CareReserve</h1>
            <p className="text-teal-100/70 text-sm font-medium">
              Sign in with your branch credentials to continue.
            </p>
          </div>
          {/* Subtle depth circle — no garish glow */}
          <div className="absolute -right-8 -bottom-12 w-48 h-48 bg-teal-800 rounded-full opacity-40 pointer-events-none" />
        </div>

        {/* ── Login card ── */}
        <section className="bg-white rounded-[2rem] shadow-sm border border-stone-100 p-8">
          <h2 className="font-bold text-stone-800 text-lg mb-1">Branch Sign In</h2>
          <p className="text-xs text-stone-400 mb-6">
            Your session is scoped to your hospital branch.
          </p>
          <LoginForm />
        </section>

        <p className="text-center text-[11px] text-stone-400 mt-4">
          CareReserve · Internal use only · Access is audited
        </p>
      </div>
    </main>
  );
}
