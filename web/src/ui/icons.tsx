import {
  ArrowDownCircle, ArrowDownRight, ArrowLeftRight, ArrowUpDown, ArrowUpRight, Banknote, Briefcase, Camera, Car,
  ChartPie, CircleDollarSign, CreditCard, Ellipsis, Gamepad2, Gift, GraduationCap, Heart, HeartPulse, House,
  Landmark, Laptop, LayoutGrid, ListChecks, Lock, Pencil, Percent, Plane, Plus, Repeat, Search, Settings, Shield,
  ShoppingBag, ShoppingCart, Star, Target, Trash2, Utensils, Wallet, X, Zap, AlertCircle, Check, ChevronDown,
  BarChart3, Gauge, Download, Upload, CarTaxiFront, Bike, Sofa, Joystick, Send, type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

const registry: Record<string, ComponentType<LucideProps>> = {
  'arrow-down-circle': ArrowDownCircle,
  'arrow-down-right': ArrowDownRight,
  'arrow-left-right': ArrowLeftRight,
  'arrow-up-down': ArrowUpDown,
  'arrow-up-right': ArrowUpRight,
  banknote: Banknote,
  briefcase: Briefcase,
  camera: Camera,
  car: Car,
  'chart-pie': ChartPie,
  'circle-dollar-sign': CircleDollarSign,
  'credit-card': CreditCard,
  ellipsis: Ellipsis,
  'gamepad-2': Gamepad2,
  gift: Gift,
  'graduation-cap': GraduationCap,
  heart: Heart,
  'heart-pulse': HeartPulse,
  house: House,
  landmark: Landmark,
  laptop: Laptop,
  'layout-grid': LayoutGrid,
  'list-checks': ListChecks,
  lock: Lock,
  pencil: Pencil,
  percent: Percent,
  plane: Plane,
  plus: Plus,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  shield: Shield,
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  star: Star,
  target: Target,
  trash: Trash2,
  utensils: Utensils,
  wallet: Wallet,
  x: X,
  zap: Zap,
  'alert-circle': AlertCircle,
  check: Check,
  'chevron-down': ChevronDown,
  'bar-chart': BarChart3,
  gauge: Gauge,
  download: Download,
  upload: Upload,
  'car-taxi-front': CarTaxiFront,
  bike: Bike,
  sofa: Sofa,
  joystick: Joystick,
  send: Send,
}

export interface IconProps extends Omit<LucideProps, 'ref'> {
  name: string
}

/** One icon set, `currentColor`, 1.5px stroke beside regular text and 2px beside semibold (pass `strokeWidth`). */
export function Icon({ name, size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  const Cmp = registry[name] ?? Ellipsis
  return <Cmp size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...rest} />
}

/** SF Symbol names stored by the Mac app → lucide names, so an imported file keeps its icons. */
const sfToLucide: Record<string, string> = {
  'creditcard.fill': 'credit-card',
  'banknote.fill': 'banknote',
  'building.columns.fill': 'landmark',
  'wallet.pass.fill': 'wallet',
  'dollarsign.circle.fill': 'circle-dollar-sign',
  'lock.fill': 'lock',
  'star.fill': 'star',
  laptopcomputer: 'laptop',
  airplane: 'plane',
  'house.fill': 'house',
  'car.fill': 'car',
  'graduationcap.fill': 'graduation-cap',
  'heart.fill': 'heart',
  'shield.fill': 'shield',
  'gift.fill': 'gift',
  'camera.fill': 'camera',
}
const lucideToSF: Record<string, string> = Object.fromEntries(Object.entries(sfToLucide).map(([k, v]) => [v, k]))

export function iconName(stored: string): string {
  return sfToLucide[stored] ?? stored
}

/** Writes the SF Symbol name back when exporting for the Mac app. */
export function toSFSymbol(name: string): string {
  return lucideToSF[name] ?? name
}
