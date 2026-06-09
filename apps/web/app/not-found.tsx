import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 pb-32 pt-6 lg:px-8 lg:py-12">
      <section className="flex flex-col gap-5 rounded-[32px] bg-surface p-5 shadow-soft lg:p-8">
        <div className="space-y-3">
          <p className="font-mono text-number-xl text-primary">404</p>
          <h1 className="max-w-[12ch] text-headline-lg text-primary">We can't find this page.</h1>
          <p className="max-w-[34rem] text-body-lg text-on-surface-variant">
            The link may be old, moved, or mistyped. Go back home, or start a new idea in Grill.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/desk"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary transition-transform active:scale-[0.97]"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              home
            </span>
            Go home
          </Link>
          <Link
            href="/grill"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-label-lg text-on-accent transition-transform active:scale-[0.97]"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              local_fire_department
            </span>
            Start in Grill
          </Link>
        </div>
      </section>
    </main>
  );
}
