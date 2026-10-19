import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed left-4 right-4 bottom-24 mx-auto max-w-[528px] bg-text text-bg rounded-card p-4 flex items-center justify-between gap-3 shadow-card">
      <span className="text-sm">A new version is ready.</span>
      <button onClick={() => updateServiceWorker(true)} className="min-h-[48px] px-4 rounded-btn bg-primary text-on-primary font-semibold">Update</button>
    </div>
  );
}
