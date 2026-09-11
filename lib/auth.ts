import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { db } from './db'

/**
 * Correo y contraseña, nada más. Sin proveedores externos, sin recuperación
 * por correo (no hay servicio de email en este MVP): menos superficie que
 * auditar. El manejo de hash de contraseña, sesiones y cookies lo hace la
 * librería, no código nuestro.
 */
export const auth = betterAuth({
  database: db(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [nextCookies()],
})

export type Session = typeof auth.$Infer.Session
