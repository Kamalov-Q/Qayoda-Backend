export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  /** Banned by an admin. Cannot log in, refresh, or open sockets. */
  BANNED = 'BANNED',
}

export enum AuthProvider {
  PHONE = 'PHONE',
  GOOGLE = 'GOOGLE',
  TELEGRAM = 'TELEGRAM',
}