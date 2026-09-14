// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { DomiApp } from '@/components/domi-app'
import { LocaleProvider } from '@/components/locale'

export default function Home() {
  return <LocaleProvider><DomiApp /></LocaleProvider>
}
