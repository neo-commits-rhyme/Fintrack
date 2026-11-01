export type Category =
  | 'salary' | 'business' | 'gifts' | 'groceries' | 'eatingOut' | 'transport'
  | 'housing' | 'utilities' | 'health' | 'entertainment' | 'shopping' | 'education'
  | 'travel' | 'subscriptions' | 'transfer' | 'debtPayment' | 'loanReceived' | 'other'

export const CATEGORIES: Category[] = [
  'salary', 'business', 'gifts', 'groceries', 'eatingOut', 'transport', 'housing', 'utilities',
  'health', 'entertainment', 'shopping', 'education', 'travel', 'subscriptions', 'transfer',
  'debtPayment', 'loanReceived', 'other',
]

/** Hue tokens map onto the categorical palette in styles/tokens.css. */
export type Tint =
  | 'green' | 'mint' | 'pink' | 'orange' | 'red' | 'blue' | 'brown' | 'yellow'
  | 'teal' | 'purple' | 'indigo' | 'cyan' | 'gray'

export interface CategoryMeta {
  title: string
  /** lucide-react icon name, resolved in ui/icons.tsx. */
  icon: string
  tint: Tint
}

export const categoryMeta: Record<Category, CategoryMeta> = {
  salary: { title: 'Salary', icon: 'banknote', tint: 'green' },
  business: { title: 'Business', icon: 'briefcase', tint: 'mint' },
  gifts: { title: 'Gifts', icon: 'gift', tint: 'pink' },
  groceries: { title: 'Groceries', icon: 'shopping-cart', tint: 'orange' },
  eatingOut: { title: 'Eating Out', icon: 'utensils', tint: 'red' },
  transport: { title: 'Transport', icon: 'car', tint: 'blue' },
  housing: { title: 'Housing', icon: 'house', tint: 'brown' },
  utilities: { title: 'Utilities', icon: 'zap', tint: 'yellow' },
  health: { title: 'Health', icon: 'heart-pulse', tint: 'teal' },
  entertainment: { title: 'Entertainment', icon: 'gamepad-2', tint: 'purple' },
  shopping: { title: 'Shopping', icon: 'shopping-bag', tint: 'indigo' },
  education: { title: 'Education', icon: 'graduation-cap', tint: 'cyan' },
  travel: { title: 'Travel', icon: 'plane', tint: 'blue' },
  subscriptions: { title: 'Subscriptions', icon: 'repeat', tint: 'purple' },
  transfer: { title: 'Transfer', icon: 'arrow-left-right', tint: 'blue' },
  debtPayment: { title: 'Debt payment', icon: 'credit-card', tint: 'orange' },
  loanReceived: { title: 'Loan received', icon: 'arrow-down-circle', tint: 'teal' },
  other: { title: 'Other', icon: 'ellipsis', tint: 'gray' },
}

/** Categories that usually represent income. "Loan received" routes money out of a debt. */
export const incomeCategories: Category[] = ['salary', 'business', 'gifts', 'loanReceived', 'other']

/** Categories that usually represent expenses. Debt payment routes money into a debt. */
export const expenseCategories: Category[] = [
  'groceries', 'eatingOut', 'transport', 'housing', 'utilities', 'health', 'entertainment',
  'shopping', 'education', 'travel', 'subscriptions', 'gifts', 'debtPayment', 'other',
]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as string[]).includes(value)
}
