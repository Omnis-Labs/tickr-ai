'use client';

import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet/use-wallet';

export default function LoginPage() {
  const router = useRouter();
  const { connected, ready, login } = useWallet();

  useEffect(() => {
    if (ready && connected) router.replace('/');
  }, [ready, connected, router]);

  const handleLogin = () => {
    login();
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-between overflow-hidden px-5 py-12">
      <div className="absolute left-1/2 top-[-10%] h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[250px] w-[250px] rounded-full bg-positive/8 blur-[100px]" />

      <div className="z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 flex h-24 w-24 rotate-45 items-center justify-center rounded-[40px] bg-gradient-to-tr from-accent to-positive"
        >
          <div className="h-10 w-10 -rotate-45 rounded-full bg-surface" />
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mb-12 flex flex-col items-center gap-4"
        >
          <h1 className="text-display-lg text-on-background">Hunch It</h1>
          <p className="max-w-[280px] text-body-lg text-on-surface-variant">
            Set your mandate. Get BUY proposals. Execute with one tap.
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-full flex-col gap-4"
        >
          <button
            onClick={handleLogin}
            className="flex h-14 w-full items-center justify-center whitespace-nowrap rounded-full bg-accent text-label-lg text-on-accent shadow-[0_8px_24px_rgba(208,233,6,0.25)] transition-transform hover:scale-[0.98] active:scale-[0.97]"
          >
            Get Started
          </button>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="z-10 mt-8 w-full max-w-md pb-4 text-center"
      >
        <p className="text-body-sm text-on-surface-variant">
          By continuing, you agree to our Terms and Privacy Policy
        </p>
      </motion.div>
    </div>
  );
}
