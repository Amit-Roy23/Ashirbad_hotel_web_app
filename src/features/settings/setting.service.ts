import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { DEFAULT_HOTEL_SETTINGS } from '@/lib/config'

export class SettingService {
  static async getSettingsMap(): Promise<Record<string, string>> {
    const rows = await prisma.setting.findMany()
    const map = { ...DEFAULT_HOTEL_SETTINGS }
    for (const r of rows) map[r.key] = r.value
    return map
  }

  static async updateSettings(settingsMap: Record<string, string>, user: RequestUser) {
    const entries = Object.entries(settingsMap)
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    }
    await logAudit('SETTINGS_UPDATE', 'Setting', null, `Updated hotel configuration settings`, user)
    return this.getSettingsMap()
  }
}
