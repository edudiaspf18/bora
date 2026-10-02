export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="mb-12 text-2xl font-bold tracking-tight">
        bora<span className="text-[#EA580C]">.</span>
      </p>
      {children}
    </div>
  );
}
