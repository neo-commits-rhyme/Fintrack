/** Localized names for core data the interface shows: categories and currencies. */
import { categoryMeta, currencyMeta, type Category, type CurrencyCode } from '../core'
import { t } from './index'

/** "Groceries" / "Продукты" / "Oziq-ovqat". */
export function categoryLabel(c: Category): string {
  return t(categoryMeta[c].title)
}

/** "US dollar" / "Доллар США" / "AQSH dollari". */
export function currencyName(c: CurrencyCode): string {
  return t(currencyMeta[c].name)
}

/**
 * What to call a transaction in lists. Entries saved without a note carry their category's English name as the
 * title (so the stored data never depends on the language); those show the category in the current language.
 */
export function transactionTitle(tx: { title: string; category: Category }): string {
  return tx.title === categoryMeta[tx.category].title ? categoryLabel(tx.category) : tx.title
}
