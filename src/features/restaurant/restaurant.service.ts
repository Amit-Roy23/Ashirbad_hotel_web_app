import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { MenuItemInput, FoodOrderInput } from './validation'

export class RestaurantService {
  static async listMenuItems() {
    return prisma.menuItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
  }

  static async createMenuItem(data: MenuItemInput, user: RequestUser) {
    const item = await prisma.menuItem.create({
      data: {
        name: data.name,
        category: data.category || 'Main Course',
        price: Number(data.price) || 0,
        available: data.available !== false,
      },
    })
    await logAudit('MENU_ITEM_CREATE', 'MenuItem', item.id, `Added menu item ${item.name} (₹${item.price})`, user)
    return item
  }

  static async updateMenuItem(id: string, data: Partial<MenuItemInput>, user: RequestUser) {
    const item = await prisma.menuItem.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.category && { category: data.category }),
        ...(data.price !== undefined && { price: Number(data.price) }),
        ...(data.available !== undefined && { available: data.available }),
      },
    })
    await logAudit('MENU_ITEM_UPDATE', 'MenuItem', id, `Updated menu item ${item.name}`, user)
    return item
  }

  static async deleteMenuItem(id: string, user: RequestUser) {
    const item = await prisma.menuItem.findUnique({ where: { id } })
    if (!item) throw new Error('Menu item not found')
    await prisma.menuItem.delete({ where: { id } })
    await logAudit('MENU_ITEM_DELETE', 'MenuItem', id, `Deleted menu item ${item.name}`, user)
    return { success: true }
  }

  static async listOrders(params: { status?: string; bookingId?: string; roomId?: string }) {
    const { status, bookingId, roomId } = params
    return prisma.foodOrder.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        items: true,
        room: true,
        booking: { include: { guest: true } },
      },
    })
  }

  static async createOrder(data: FoodOrderInput, user: RequestUser) {
    let total = 0
    for (const item of data.items) {
      total += item.price * item.quantity
    }

    const order = await prisma.foodOrder.create({
      data: {
        bookingId: data.bookingId || null,
        roomId: data.roomId || null,
        tableNo: data.tableNo || null,
        total,
        status: 'PENDING',
        createdBy: user.name || 'Staff',
        notes: data.notes || null,
        items: {
          create: data.items.map((i) => ({
            menuItemId: i.menuItemId || null,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
          })),
        },
      },
      include: { items: true, room: true },
    })

    await logAudit('FOOD_ORDER_CREATE', 'FoodOrder', order.id, `Created food order ₹${order.total}`, user)
    return order
  }
}
