import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Config } from './config.js'

export const COOKIE = 'relay_token'
const WEEK_MS = 7 * 24 * 3600 * 1000

// Compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10)
export const checkPassword = (pw: string, hash: string | undefined) => bcrypt.compare(pw, hash ?? DUMMY_HASH).then((ok) => ok && !!hash)

export function setSession(res: Response, config: Config, userId: string) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' })
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: WEEK_MS, path: '/' })
}

export const clearSession = (res: Response) => void res.clearCookie(COOKIE, { path: '/' })

declare module 'express-serve-static-core' {
  interface Request { userId?: string }
}

export const readSession = (config: Config) => (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE]
  if (token) {
    try {
      const p = jwt.verify(token, config.jwtSecret) as { sub?: string }
      if (p.sub) req.userId = p.sub
    } catch { /* expired or forged: treated as logged out */ }
  }
  next()
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return void res.status(401).json({ error: 'sign in first' })
  next()
}
