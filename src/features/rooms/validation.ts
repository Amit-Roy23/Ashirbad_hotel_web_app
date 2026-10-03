import { z } from 'zod'

export const RoomStatusEnum = z.enum(['VACANT', 'OCCUPIED', 'MAINTENANCE', 'RESERVED'])
export const HousekeepingStatusEnum = z.enum(['CLEAN', 'DIRTY', 'IN_PROGRESS'])

export const CreateRoomSchema = z.object({
  number: z.string().min(1, 'Room number is required'),
  floor: z.string().optional(),
  type: z.string().default('Non-AC'),
  capacity: z.number().int().positive().default(2),
  rate: z.number().nonnegative().default(1000),
  status: RoomStatusEnum.default('VACANT'),
  housekeeping: HousekeepingStatusEnum.default('CLEAN'),
  notes: z.string().nullable().optional(),
})

export const UpdateRoomSchema = CreateRoomSchema.partial()

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>
export type UpdateRoomInput = z.infer<typeof UpdateRoomSchema>
