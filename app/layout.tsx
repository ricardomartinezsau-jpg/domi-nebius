import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Next } from 'next/font/google'
import './globals.css'
import './flow.css'

const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], display: 'swap', variable: '--font-atkinson' })

export const metadata: Metadata = {
  title: 'Domi — una cosa en movimiento',
  description: 'Domi reparte tus pendientes en cuatro bandejas y te ayuda a comenzar una acción, con inferencia real de Nebius Token Factory.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es" className={atkinson.variable}><body>{children}</body></html>
}
