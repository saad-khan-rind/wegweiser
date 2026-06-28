import { AppHeader } from './AppHeader'

export function HelpLayout({ children, bottomNav }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7faf9]">
      <AppHeader />

      <main className="relative z-10 mx-auto w-full max-w-none px-0 pb-28 pt-2 lg:pb-16">
        {children}
      </main>

      {bottomNav}
    </div>
  )
}
