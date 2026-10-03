import { prisma } from '@/lib/prisma'

export interface RequestUser {
  id?: string
  name?: string
  role?: string
}

export async function logAudit(
  action: string,
  entity: string,
  entityId: string | null | undefined,
  details: string,
  user: RequestUser
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId || null,
        details,
        userName: user.name || null,
        userRole: user.role || null,
      },
    })
  } catch (e) {
    console.error('Audit log creation error:', e)
  }
}
