import bcrypt from 'bcryptjs'

const ROUNDS = 12

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, ROUNDS)
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  try {
    return bcrypt.compareSync(password, passwordHash)
  } catch (error) {
    // A hash that is not bcrypt is a failed login, not a crash.
    void error
    return false
  }
}
