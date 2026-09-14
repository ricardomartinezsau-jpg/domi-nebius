// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Next } from 'next/font/google'
import './globals.css'
import './flow.css'

const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], display: 'swap', variable: '--font-atkinson' })

export const metadata: Metadata = {
  title: 'Domi — one thing in motion',
  description: 'Sort your tasks into four trays, find one place to start, and get a source-backed research guide. Powered by Nebius Token Factory.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={atkinson.variable}><body>{children}</body></html>
}
