/** Restaurant expense heads. An expense is a ledger EXPENSE row in the RESTAURANT category, described as "Head: note". */
export const RESTAURANT_EXPENSE_HEADS = [
  'Vegetables',
  'Grocery',
  'Meat & Fish',
  'Milk & Dairy',
  'Gas / Fuel',
  'Kitchen Staff',
  'Utensils',
  'Packing',
  'Other',
] as const

/** "Vegetables: Onion, potato" → head "Vegetables"; anything else falls under Other */
export function expenseHead(description: string): string {
  const head = description.split(':')[0].trim()
  return (RESTAURANT_EXPENSE_HEADS as readonly string[]).includes(head) ? head : 'Other'
}
