import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LandingHeader } from './_landing/header';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-on-background selection:bg-accent selection:text-on-accent overflow-x-hidden">
      <LandingHeader />

      <main>
        <section
          className="relative min-h-[calc(100vh-72px)] flex flex-col justify-center pt-24 pb-section"
          aria-label="Hero"
        >
          <div className="max-w-screen-xl mx-auto px-5 w-full flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            <div className="flex-1 flex flex-col items-start z-10">
              <h1 className="text-display-lg lg:text-[64px] lg:leading-[72px] tracking-tight font-bold text-on-background mb-6 max-w-2xl">
                Market moves.<br />
                Clear signals.<br />
                One tap.
              </h1>

              <p className="text-title-lg text-on-surface-variant max-w-xl mb-10 font-normal">
                AI-driven trading signals for tokenized US stocks on Solana. We translate market data into clear proposals, you execute in seconds. Every position is protected.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                <Button variant="accent" size="lg" className="h-14 px-10 text-[16px] w-full sm:w-auto" asChild>
                  <Link href="/login">Get Started</Link>
                </Button>
                <p className="text-body-sm text-on-surface-variant font-medium mt-2 sm:mt-0">
                  Built on Solana • Self-custodial
                </p>
              </div>
            </div>

            <div className="flex-1 w-full max-w-md lg:max-w-none relative flex justify-center lg:justify-end">
              <div className="relative w-full aspect-square max-w-[400px]">
                <div className="absolute inset-0 bg-surface rounded-full blur-3xl opacity-60" />

                <div className="absolute top-4 right-4 lg:-right-8 w-64 bg-surface rounded-lg p-card-padding shadow-floating z-20 border border-outline-variant transform rotate-3">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-on-accent">
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      </div>
                      <span className="text-label-lg text-on-surface">BUY TSLA</span>
                    </div>
                    <span className="bg-positive-container text-on-secondary-container px-2 py-1 rounded-full text-label-sm font-bold">
                      HIGH
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="h-2 bg-surface-container rounded-full w-full" />
                    <div className="h-2 bg-surface-container rounded-full w-5/6" />
                    <div className="h-2 bg-surface-container rounded-full w-4/6" />
                  </div>
                </div>

                <div className="absolute bottom-12 left-0 lg:-left-12 w-72 bg-accent rounded-lg p-card-padding shadow-card z-30 border border-transparent transform -rotate-2">
                  <div className="flex justify-between items-end mb-6">
                    <div>
                      <div className="text-label-sm text-on-surface-variant mb-1 font-bold">PROPOSED ENTRY</div>
                      <div className="text-number-lg text-on-surface tracking-tight">$184.20</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12 7-7 7 7" />
                        <path d="M12 19V5" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-surface/40 h-10 rounded-full" />
                    <div className="flex-1 bg-primary text-on-primary rounded-full flex items-center justify-center text-label-md font-bold">
                      EXECUTE
                    </div>
                  </div>
                </div>

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-outline-variant rounded-full border-dashed animate-spin-slow" />
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-surface-container-low" aria-label="How it works">
          <div className="max-w-screen-xl mx-auto px-5">
            <div className="text-center mb-20">
              <h2 className="text-headline-lg font-bold text-on-background mb-4">Trading, distilled.</h2>
              <p className="text-title-md text-on-surface-variant font-normal max-w-2xl mx-auto">
                No complex charts or endless indicators. Just clear signals mapped to your goals.
              </p>
            </div>

            <div className="relative">
              <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-outline-variant -translate-x-1/2" />

              <div className="space-y-24">
                <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-20">
                  <div className="flex-1 flex justify-end w-full lg:w-auto text-left lg:text-right">
                    <div className="max-w-md lg:pr-10">
                      <div className="text-accent-bright font-bold text-display-lg mb-2 opacity-50">01</div>
                      <h3 className="text-title-lg font-bold text-on-background mb-3">Set your mandate</h3>
                      <p className="text-body-lg text-on-surface-variant">
                        Tell us what you want to trade and your risk tolerance. We filter the noise and only look for opportunities that match your specific profile.
                      </p>
                    </div>
                  </div>
                  <div className="hidden lg:flex w-12 h-12 bg-surface rounded-full border-4 border-surface-container-low z-10 items-center justify-center shadow-micro absolute left-1/2 -translate-x-1/2">
                    <div className="w-4 h-4 bg-primary rounded-full" />
                  </div>
                  <div className="flex-1 w-full lg:w-auto">
                    <div className="bg-surface p-card-padding rounded-lg shadow-soft border border-outline-variant max-w-sm">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                        </div>
                        <span className="font-bold text-title-md">Mandate</span>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-surface-container rounded-md">
                          <span className="text-label-md">Tech Stocks</span>
                          <div className="w-8 h-5 bg-primary rounded-full relative"><div className="absolute right-1 top-1 w-3 h-3 bg-surface rounded-full" /></div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-surface-container rounded-md">
                          <span className="text-label-md">Risk Level</span>
                          <span className="text-label-md font-bold">Moderate</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row-reverse items-center gap-10 lg:gap-20">
                  <div className="flex-1 w-full lg:w-auto text-left">
                    <div className="max-w-md lg:pl-10">
                      <div className="text-accent-bright font-bold text-display-lg mb-2 opacity-50">02</div>
                      <h3 className="text-title-lg font-bold text-on-background mb-3">Review AI proposals</h3>
                      <p className="text-body-lg text-on-surface-variant">
                        When a setup aligns with your mandate, we send a clear proposal. You get the entry point, target, stop loss, and plain-English reasoning for the trade.
                      </p>
                    </div>
                  </div>
                  <div className="hidden lg:flex w-12 h-12 bg-surface rounded-full border-4 border-surface-container-low z-10 items-center justify-center shadow-micro absolute left-1/2 -translate-x-1/2">
                    <div className="w-4 h-4 bg-primary rounded-full" />
                  </div>
                  <div className="flex-1 flex justify-start lg:justify-end w-full lg:w-auto">
                    <div className="bg-accent p-card-padding rounded-lg shadow-soft max-w-sm w-full">
                      <div className="bg-primary text-on-primary text-label-sm inline-block px-3 py-1 rounded-full mb-4">NEW PROPOSAL</div>
                      <h4 className="text-title-md font-bold mb-2">Long AAPL</h4>
                      <p className="text-body-sm text-on-surface mb-6 opacity-80">
                        Earnings momentum breaking overhead resistance. Tech sector rotation confirms strength.
                      </p>
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <div className="bg-surface/30 p-3 rounded-md">
                          <div className="text-label-sm opacity-70 mb-1">Target</div>
                          <div className="font-bold">$192.50</div>
                        </div>
                        <div className="bg-surface/30 p-3 rounded-md">
                          <div className="text-label-sm opacity-70 mb-1">Stop Loss</div>
                          <div className="font-bold">$178.00</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-20">
                  <div className="flex-1 flex justify-end w-full lg:w-auto text-left lg:text-right">
                    <div className="max-w-md lg:pr-10">
                      <div className="text-accent-bright font-bold text-display-lg mb-2 opacity-50">03</div>
                      <h3 className="text-title-lg font-bold text-on-background mb-3">Execute with one tap</h3>
                      <p className="text-body-lg text-on-surface-variant">
                        Swipe to execute. We handle the routing and automatically place your take-profit and stop-loss orders. Your downside is always protected.
                      </p>
                    </div>
                  </div>
                  <div className="hidden lg:flex w-12 h-12 bg-surface rounded-full border-4 border-surface-container-low z-10 items-center justify-center shadow-micro absolute left-1/2 -translate-x-1/2">
                    <div className="w-4 h-4 bg-primary rounded-full" />
                  </div>
                  <div className="flex-1 w-full lg:w-auto">
                    <div className="bg-surface p-card-padding rounded-lg shadow-card border border-outline-variant max-w-sm flex items-center justify-between">
                      <div className="font-bold text-title-md">Execute Trade</div>
                      <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center shadow-micro">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24" aria-label="Benefits">
          <div className="max-w-screen-xl mx-auto px-5">
            <div className="flex flex-col md:flex-row gap-12 lg:gap-24 items-center">
              <div className="flex-1 space-y-12">
                <div>
                  <div className="w-12 h-12 bg-secondary-container rounded-full flex items-center justify-center text-on-secondary-container mb-4">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
                    </svg>
                  </div>
                  <h3 className="text-headline-md font-bold mb-3">Transparent reasoning</h3>
                  <p className="text-body-lg text-on-surface-variant">
                    We never hide the &ldquo;why&rdquo;. Every signal includes the exact technical and fundamental reasoning so you can learn while you earn. Trust is built on transparency.
                  </p>
                </div>

                <div>
                  <div className="w-12 h-12 bg-positive-container rounded-full flex items-center justify-center text-positive mb-4">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <h3 className="text-headline-md font-bold mb-3">Automatic protection</h3>
                  <p className="text-body-lg text-on-surface-variant">
                    Capital preservation is paramount. Every position automatically comes with take-profit and stop-loss parameters. Walk away from your screen with peace of mind.
                  </p>
                </div>
              </div>

              <div className="flex-1 w-full relative">
                <div className="bg-surface border border-outline-variant rounded-2xl p-8 shadow-floating max-w-lg mx-auto">
                  <div className="flex justify-between items-center mb-8 pb-6 border-b border-outline-variant">
                    <span className="text-title-lg font-bold">Position Active</span>
                    <span className="bg-positive-container text-positive px-3 py-1 rounded-full text-label-md font-bold flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-positive" /> Protected
                    </span>
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-end">
                      <span className="text-label-lg text-on-surface-variant">Take Profit</span>
                      <span className="text-title-md font-bold text-positive">$210.50</span>
                    </div>

                    <div className="w-full bg-surface-container rounded-full h-3 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-[60%] bg-accent rounded-full border-r-2 border-surface" />
                      <div className="absolute left-[60%] top-0 bottom-0 w-2 bg-primary" />
                    </div>

                    <div className="flex justify-between items-end">
                      <span className="text-label-lg text-on-surface-variant">Stop Loss</span>
                      <span className="text-title-md font-bold text-negative">$175.00</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 md:py-32 bg-accent px-5" aria-label="Call to action">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-display-lg md:text-[56px] leading-tight font-bold text-primary mb-6">
              Ready to trade with clarity?
            </h2>
            <p className="text-title-lg text-primary/80 mb-10 max-w-xl mx-auto font-medium">
              Join the smart money on Solana. Clear signals, fast execution, full protection.
            </p>
            <Button variant="default" size="lg" className="h-16 px-12 text-[18px] w-full sm:w-auto shadow-floating" asChild>
              <Link href="/login">Get Started Now</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t border-outline-variant bg-surface" aria-label="Footer">
        <div className="max-w-screen-xl mx-auto px-5 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-title-md font-bold tracking-tight text-on-surface">
            Hunch It
          </div>
          <div className="flex gap-6 text-label-lg text-on-surface-variant">
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
          </div>
          <div className="text-label-sm text-on-surface-variant opacity-80">
            Built on Solana
          </div>
        </div>
      </footer>
    </div>
  );
}
