import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seeding...')

  // 1. Seed the hotel's rooms (client list: Ground floor 101-103, 1st floor 201-212, 2nd floor 301-316)
  const roomCount = await prisma.room.count()
  if (roomCount === 0) {
    const roomData: { number: string; floor: string; type: string; capacity: number; rate: number; status?: string; notes?: string }[] = [
      { number: '101', floor: 'Ground', type: 'Double Bed', capacity: 2, rate: 700 },
      { number: '102', floor: 'Ground', type: 'Double Bed', capacity: 2, rate: 800 },
      { number: '103', floor: 'Ground', type: 'Triple Bed (AC)', capacity: 3, rate: 1200 },
      { number: '201', floor: '1', type: 'Double Bed (AC)', capacity: 2, rate: 1000 },
      { number: '202', floor: '1', type: 'Single Bed', capacity: 1, rate: 500 },
      { number: '203', floor: '1', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '204', floor: '1', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '205', floor: '1', type: 'Single Bed', capacity: 1, rate: 500 },
      { number: '206', floor: '1', type: 'Single Bed', capacity: 1, rate: 500 },
      { number: '207', floor: '1', type: 'Single Bed', capacity: 1, rate: 500 },
      { number: '208', floor: '1', type: 'Triple Bed (AC)', capacity: 3, rate: 1200 },
      { number: '209', floor: '1', type: 'Double Bed (AC)', capacity: 2, rate: 1000 },
      { number: '210', floor: '1', type: 'Double Bed (AC)', capacity: 2, rate: 1000 },
      { number: '211', floor: '1', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '212', floor: '1', type: 'Single Bed (Non-Attached)', capacity: 1, rate: 300 },
      { number: '301', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '302', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '303', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '304', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '305', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '306', floor: '2', type: 'Six Bed', capacity: 6, rate: 1500 },
      { number: '307', floor: '2', type: 'Double Bed (AC)', capacity: 2, rate: 1000 },
      { number: '308', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 800 },
      { number: '309', floor: '2', type: 'Triple Bed (AC)', capacity: 3, rate: 1500 },
      { number: '310', floor: '2', type: 'Triple Bed (AC)', capacity: 3, rate: 1500 },
      { number: '311', floor: '2', type: 'Single Bed (AC)', capacity: 1, rate: 900 },
      { number: '312', floor: '2', type: 'Double Bed (AC)', capacity: 2, rate: 1000 },
      { number: '313', floor: '2', type: 'Single Bed (Non-Attached)', capacity: 1, rate: 300 },
      { number: '314', floor: '2', type: 'Double Bed (Non-Attached)', capacity: 2, rate: 500 },
      { number: '315', floor: '2', type: 'Blocked', capacity: 1, rate: 0, status: 'MAINTENANCE', notes: 'Blocked - not available for guests' },
      { number: '316', floor: '2', type: 'Double Bed (Non-Attached)', capacity: 2, rate: 500 },
    ]
    await prisma.room.createMany({ data: roomData })
    console.log(`✓ Seeded ${roomData.length} rooms`)
  } else {
    console.log(`ℹ Rooms already exist (${roomCount} found)`)
  }

  // 2. Seed menu items
  const menuCount = await prisma.menuItem.count()
  if (menuCount === 0) {
    const menu = [
      { name: 'Rice (Plate)', category: 'Rice & Bread', price: 60 },
      { name: 'Roti', category: 'Rice & Bread', price: 12 },
      { name: 'Paratha', category: 'Rice & Bread', price: 25 },
      { name: 'Dal (Bowl)', category: 'Main Course', price: 50 },
      { name: 'Chicken Curry', category: 'Main Course', price: 160 },
      { name: 'Fish Curry (Katla)', category: 'Main Course', price: 140 },
      { name: 'Mutton Kosha', category: 'Main Course', price: 220 },
      { name: 'Egg Curry', category: 'Main Course', price: 80 },
      { name: 'Paneer Butter Masala', category: 'Main Course', price: 170 },
      { name: 'Mixed Veg', category: 'Main Course', price: 110 },
      { name: 'Chicken Fried Rice', category: 'Main Course', price: 130 },
      { name: 'Omelette', category: 'Breakfast', price: 40 },
      { name: 'Bread Butter', category: 'Breakfast', price: 50 },
      { name: 'Poha', category: 'Breakfast', price: 40 },
      { name: 'Puri Sabji', category: 'Breakfast', price: 60 },
      { name: 'Samosa', category: 'Snacks', price: 20 },
      { name: 'French Fries', category: 'Snacks', price: 90 },
      { name: 'Chicken Pakora', category: 'Snacks', price: 110 },
      { name: 'Tea', category: 'Beverages', price: 15 },
      { name: 'Coffee', category: 'Beverages', price: 30 },
      { name: 'Cold Drink (250ml)', category: 'Beverages', price: 25 },
      { name: 'Mineral Water (1L)', category: 'Beverages', price: 20 },
    ]
    await prisma.menuItem.createMany({ data: menu })
    console.log(`✓ Seeded ${menu.length} menu items`)
  } else {
    console.log(`ℹ Menu items already exist (${menuCount} found)`)
  }

  // 3. Seed staff
  const staffCount = await prisma.staff.count()
  if (staffCount === 0) {
    await prisma.staff.createMany({
      data: [
        { name: 'Ramesh Das', role: 'Manager', salary: 18000, phone: '9830011122' },
        { name: 'Sunita Halder', role: 'Reception', salary: 9000, phone: '9830033344' },
        { name: 'Mohan Roy', role: 'Housekeeping', salary: 7000 },
        { name: 'Sabitri Mardi', role: 'Housekeeping', salary: 7000 },
        { name: 'Chef Abdul Karim', role: 'Chef', salary: 14000, phone: '9830055566' },
        { name: 'Bikram Singh', role: 'Guard', salary: 8000 },
      ],
    })
    console.log('✓ Seeded staff members')
  } else {
    console.log(`ℹ Staff already exist (${staffCount} found)`)
  }

  // 4. Seed demo guests
  const guestCount = await prisma.guest.count()
  if (guestCount === 0) {
    await prisma.guest.createMany({
      data: [
        { phone: '9123456780', name: 'Arun Kumar Sharma', company: 'Sharma Traders Pvt Ltd', gst: '19AABCS1429B1ZX' },
        { phone: '9123456781', name: 'Priya Sen', company: 'Sen Enterprises', gst: '19AACFS8291K1Z2' },
      ],
    })
    console.log('✓ Seeded demo guests')
  } else {
    console.log(`ℹ Guests already exist (${guestCount} found)`)
  }

  // 5. Seed app users (PINs for Admin, Manager, Reception)
  const users = [
    { name: 'Admin', role: 'ADMIN', pin: '1111' },
    { name: 'Manager', role: 'MANAGER', pin: '2222' },
    { name: 'Reception', role: 'RECEPTION', pin: '3333' },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { name: u.name },
      update: { role: u.role, pin: u.pin, active: true },
      create: { name: u.name, role: u.role, pin: u.pin, active: true },
    })
  }
  console.log('✓ Seeded/verified app users (Admin: 1111, Manager: 2222, Reception: 3333)')

  // 6. Seed settings
  const settings = [
    { key: 'hotelName', value: 'Ashirbad Lodge' },
    { key: 'hotelAddress', value: 'Station Road, Kolkata' },
    { key: 'hotelPhone', value: '+91 90000 00000' },
    { key: 'hotelGstin', value: '' },
    { key: 'restaurantName', value: 'Ashirbad Restaurant' },
    { key: 'restaurantAddress', value: 'Station Road, Kolkata' },
    { key: 'restaurantPhone', value: '+91 90000 00000' },
    { key: 'restaurantGstin', value: '' },
    { key: 'gstPercent', value: '12' },
    { key: 'invoicePrefix', value: 'INV' },
    { key: 'invoiceCounter', value: '1' },
  ]
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    })
  }
  console.log('✓ Seeded/verified default settings')

  // 7. Seed expense categories
  const categories = [
    'Salary',
    'Staff Advance',
    'Groceries / Purchase',
    'Utilities (EB/Water)',
    'Repairs & Maintenance',
    'Housekeeping Supplies',
    'Transport',
    'Marketing',
    'Petty Cash',
    'Other',
  ]
  for (const name of categories) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name, active: true },
    })
  }
  console.log('✓ Seeded/verified 10 expense categories')

  console.log('🎉 Seeding completed successfully!')
}

main()
  .catch((e) => {
    console.error('Seeding error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
