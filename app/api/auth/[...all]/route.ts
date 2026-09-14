// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

export const runtime = 'nodejs'

export const { GET, POST } = toNextJsHandler(auth)
