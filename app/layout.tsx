import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Domi — Brain Dump Triage (Nebius Token Factory)',
  description:
    'Suelta tu vaciado mental caótico y recibe 4 bandejas de vida, orden de dependencias, micro-tareas y un arranque de 2 minutos, generado por Meta Llama 3.3 70B en Nebius Token Factory.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
