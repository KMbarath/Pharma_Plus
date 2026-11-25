import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import ArrowLeft from 'lucide-react/icons/arrow-left'
import ArrowUpRight from 'lucide-react/icons/arrow-up-right'
import BadgeAlert from 'lucide-react/icons/badge-alert'
import Bell from 'lucide-react/icons/bell'
import BellRing from 'lucide-react/icons/bell-ring'
import Camera from 'lucide-react/icons/camera'
import Check from 'lucide-react/icons/check'
import Heart from 'lucide-react/icons/heart'
import Home from 'lucide-react/icons/home'
import Minus from 'lucide-react/icons/minus'
import Pill from 'lucide-react/icons/pill'
import Plus from 'lucide-react/icons/plus'
import Search from 'lucide-react/icons/search'
import ShoppingBag from 'lucide-react/icons/shopping-bag'
import Star from 'lucide-react/icons/star'
import Truck from 'lucide-react/icons/truck'
import User from 'lucide-react/icons/user'
import X from 'lucide-react/icons/x'
import ClipboardList from 'lucide-react/icons/clipboard-list'
import LogOut from 'lucide-react/icons/log-out'
import LogIn from 'lucide-react/icons/log-in'
import LayoutGrid from 'lucide-react/icons/layout-grid'
import PackageCheck from 'lucide-react/icons/package-check'
import MapPin from 'lucide-react/icons/map-pin'
import Phone from 'lucide-react/icons/phone'
import Mail from 'lucide-react/icons/mail'
import CalendarDays from 'lucide-react/icons/calendar-days'
import Package from 'lucide-react/icons/package'
import CircleCheck from 'lucide-react/icons/circle-check'
import Pencil from 'lucide-react/icons/pencil'
import Trash2 from 'lucide-react/icons/trash-2'
import type { LucideIcon } from 'lucide-react'
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import './ReferenceDesign.css'

type Product = {
  id: number
  pharmacyId: number
  pharmacyName: string
  name: string
  brandName: string | null
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  packQuantity: number | null
  packUnit: string | null
  deliveryFee?: number | null
  pickupAvailable?: boolean
  category: string
  pack: string
  price: number
  stock: number
  originalPrice?: number
  image: string
  imageUrl?: string | null
  rating?: number
  reviewCount?: number
  description: string
  manufacturer?: string | null
  batchNumber?: string | null
  expiryDate?: string | null
  prescriptionRequired?: boolean
  available?: boolean
  availabilityReason?: string | null
  warnings?: string[]
  badge?: string
}

type CartItem = Product & {
  pharmacy_id: number
  quantity: number
}

type InventoryRecord = {
  id: number
  pharmacyId: number
  pharmacyName: string
  name: string
  brandName: string | null
  strength: string | null
  dosageForm: string | null
  packQuantity: number | null
  packUnit: string | null
  deliveryFee?: number | null
  pickupAvailable?: boolean
  category: string
  pack: string
  price: number
  stock: number
  reorderLevel: number
  expiry: string | null
  sku: string | null
  genericName: string | null
  manufacturer: string | null
  batchNumber: string | null
  gstRate: number
  hsnCode: string | null
  prescriptionRequired: boolean
  description: string | null
  imageUrl: string | null
  available: boolean
  rating?: number
  reviewCount?: number
}

type MedicineForm = {
  name: string
  brandName: string
  category: string
  pack: string
  strength: string
  dosageForm: string
  packQuantity: string
  packUnit: string
  price: string
  stock: string
  reorderLevel: string
  expiry: string
  sku: string
  genericName: string
  manufacturer: string
  batchNumber: string
  gstRate: string
  hsnCode: string
  prescriptionRequired: boolean
  description: string
  imageUrl: string
}

type AccountRole = 'customer' | 'pharmacy_owner' | 'admin'

type AccountUser = {
  id: number
  role: AccountRole
  fullName: string
  email: string
  phone: string | null
  pharmacyId: number | null
  pharmacyName: string | null
  pharmacyPhone: string | null
  pharmacyAddress: string | null
  pharmacyCity: string | null
  pharmacyState: string | null
  pharmacyPostalCode: string | null
  drugLicenseNumber: string | null
}

type AccountSession = {
  token: string
  user: AccountUser
}

type CustomerAddress = {
  id: number
  label: string
  contactPhone: string | null
  address: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
  isDefault: boolean
}

type PrescriptionItem = {
  medicineId: number
  name: string
  requestedQuantity: number
  approvedQuantity: number | null
  remainingQuantity: number
  medicineMatches?: boolean | null
}

type PrescriptionRecord = {
  id: number
  status: 'pending' | 'approved' | 'rejected' | 'correction_required'
  submittedAt: string
  prescriptionDate: string | null
  validUntil: string | null
  reviewReason: string | null
  retentionUntil: string
  documentAvailable: boolean
  customerName?: string
  items: PrescriptionItem[]
}

type PharmacyChoice = {
  id: number
  name: string
  city: string | null
  state: string | null
}

type ProductComparisonListing = {
  medicineId: number
  pharmacyId: number
  pharmacyName: string
  address: string | null
  city: string | null
  state: string | null
  phone: string | null
  name: string
  brandName: string
  genericName: string
  strength: string
  dosageForm: string
  packQuantity: number
  packUnit: string
  pack: string
  price: number
  prescriptionRequired: boolean
  available: boolean
  availableStock: number
  pickupAvailable: boolean
  deliveryFee: number | null
  estimatedDeliveryTotal: number | null
  distanceKm: number | null
  description: string | null
  imageUrl: string | null
  category: string
}

type NonIdenticalListing = {
  medicineId: number
  pharmacyId: number
  pharmacyName: string
  name: string
  brandName: string | null
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  packQuantity: number | null
  packUnit: string | null
  pack: string
  price: number
  available: boolean
  availableStock: number
  nonIdentical: true
}

type ProductComparison = {
  product: {
    id: number
    pharmacyId: number
    pharmacyName: string
    name: string
    brandName: string | null
    genericName: string | null
    strength: string | null
    dosageForm: string | null
    packQuantity: number | null
    packUnit: string | null
    pack: string
    category: string
    price: number
    availableStock: number
    description: string | null
    imageUrl: string | null
    identityComplete: boolean
  }
  listings: ProductComparisonListing[]
  nonIdenticalListings: NonIdenticalListing[]
}

type OrderEvent = {
  status: string
  createdAt: string
}

type CustomerOrder = {
  id: number
  orderNumber: string
  status: string
  pharmacyId: number
  pharmacyName: string
  customerName?: string
  customerPhone?: string | null
  total: number
  subtotal: number
  discountAmount: number
  discountCode: string | null
  taxAmount: number
  deliveryFee: number
  paymentMethod: string
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'failed'
  deliveryAddress: string | null
  fulfillmentMethod: 'delivery' | 'pickup'
  deliveryLatitude: number | null
  deliveryLongitude: number | null
  createdAt: string
  updatedAt: string
  items: Array<{
    medicineId: number
    name: string
    quantity: number
    prescriptionId: number | null
    prescriptionRequired: boolean
    packQuantity: number | null
    baseUnitQuantity: number | null
    baseUnitName: string | null
    unitPrice: number
    discountAmount: number
    taxAmount: number
    lineTotal: number
  }>
  events: OrderEvent[]
  deliveryOtp?: string
}

type CheckoutQuoteLine = {
  medicineId: number
  pharmacyId: number
  prescriptionId: number | null
  prescriptionRequired: boolean
  prescriptionValidUntil: string | null
  name: string
  quantity: number
  availableQuantity: number
  packQuantity: number | null
  packUnit: string | null
  baseUnitQuantity: number | null
  unitPrice: number
  lineSubtotal: number
  taxRate: number
  discountAmount: number
  taxAmount: number
  lineTotal: number
}

type CheckoutQuote = {
  quoteId: string
  expiresAt: string
  pharmacyId: number
  pharmacyName: string
  items: CheckoutQuoteLine[]
  fulfillmentMethod: 'delivery' | 'pickup'
  addressId: number | null
  deliveryAddress: string | null
  paymentMethod: string
  discount: { code: string; description: string | null; type: string; value: number } | null
  discountCode: string | null
  subtotal: number
  discountAmount: number
  taxAmount: number
  deliveryFee: number
  total: number
}

const SESSION_STORAGE_KEY = 'pharma-plus-session-token'

type CustomerProfile = {
  user: AccountUser
  addresses: CustomerAddress[]
}

type OwnerSession = AccountSession

type SessionResponse = {
  user: AccountUser
  error?: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const apiUrl = (path: string) => `${API_BASE_URL}${path}`

type ProfileForm = {
  fullName: string
  phone: string
}

type AddressForm = {
  label: string
  contactPhone: string
  address: string
  city: string
  state: string
  postalCode: string
  latitude: number | null
  longitude: number | null
  isDefault: boolean
}

const emptyProfileForm = (): ProfileForm => ({
  fullName: '',
  phone: '',
})

const emptyAddressForm = (): AddressForm => ({
  label: 'Home',
  contactPhone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  latitude: null,
  longitude: null,
  isDefault: false,
})

const formatCustomerAddress = (address?: CustomerAddress | null) => {
  if (!address) return ''
  const text = [address.address, address.city, address.state, address.postalCode].filter(Boolean).join(', ')
  const coordinates = address.latitude !== null && address.longitude !== null
    ? `GPS coordinates: ${address.latitude.toFixed(5)}, ${address.longitude.toFixed(5)}`
    : ''
  return [text, coordinates].filter(Boolean).join(' · ')
}

const formatOrderLocation = (order: CustomerOrder) => {
  const coordinates = order.deliveryLatitude !== null && order.deliveryLatitude !== undefined &&
      order.deliveryLongitude !== null && order.deliveryLongitude !== undefined
    ? `GPS coordinates: ${order.deliveryLatitude.toFixed(5)}, ${order.deliveryLongitude.toFixed(5)}`
    : ''
  return [order.deliveryAddress, coordinates].filter(Boolean).join(' · ') ||
    (order.fulfillmentMethod === 'pickup' ? 'Pickup at pharmacy' : 'No delivery location details')
}

const formatOrderItemQuantity = (item: CustomerOrder['items'][number]) =>
  `${item.quantity} pack(s)${item.baseUnitQuantity !== null ? ` / ${item.baseUnitQuantity} ${item.baseUnitName}` : ''}`

const sessionStorageToken = () => localStorage.getItem(SESSION_STORAGE_KEY)

function saveAccountSession(session: AccountSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, session.token)
}

function authenticatedApiFetch(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(apiUrl(path), { ...init, headers })
}

function ownerApiFetch(path: string, token: string, init: RequestInit = {}) {
  return authenticatedApiFetch(path, token, init)
}

const emptyMedicineForm = (): MedicineForm => ({
  name: '',
  brandName: '',
  category: '',
  pack: '',
  strength: '',
  dosageForm: '',
  packQuantity: '',
  packUnit: '',
  price: '',
  stock: '0',
  reorderLevel: '10',
  expiry: '',
  sku: '',
  genericName: '',
  manufacturer: '',
  batchNumber: '',
  gstRate: '0',
  hsnCode: '',
  prescriptionRequired: false,
  description: '',
  imageUrl: '',
})

const categories = [
  { name: 'Tablets', icon: '💊' },
  { name: 'Capsules', icon: '🧴' },
  { name: 'Syrups', icon: '🥤' },
  { name: 'First Aid', icon: '🩹' },
  { name: 'Syringes', icon: '💉' },
  { name: 'ORS', icon: '🧃' },
  { name: 'Sprays', icon: '🧪' },
  { name: 'Vitamins', icon: '🌿' },
  { name: 'Medical Devices', icon: '🩺' },
]

const sidebarItems: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'Home', icon: LayoutGrid },
  { label: 'Orders', icon: ClipboardList },
  { label: 'Prescriptions', icon: ClipboardList },
  { label: 'Medicines', icon: Pill },
  { label: 'Delivery', icon: Truck },
  { label: 'Verification', icon: BadgeAlert },
]

const customerTabs = ['Home', 'Search', 'Favorites', 'Cart', 'Profile']

function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartError, setCartError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [pharmacies, setPharmacies] = useState<PharmacyChoice[]>([])
  const [selectedPharmacyId, setSelectedPharmacyId] = useState('')
  const [storeCategories, setStoreCategories] = useState(categories)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All medicines')
  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery')

  const refreshCatalog = async () => {
    try {
      const [medicinesResponse, categoriesResponse, pharmaciesResponse] = await Promise.all([
        fetch(apiUrl('/api/catalog/medicines')),
        fetch(apiUrl('/api/catalog/categories')),
        fetch(apiUrl('/api/catalog/pharmacies')),
      ])
      const [medicinesResult, categoriesResult, pharmaciesResult] = await Promise.all([
        medicinesResponse.json(),
        categoriesResponse.json(),
        pharmaciesResponse.json(),
      ])
      if (!medicinesResponse.ok) throw new Error(medicinesResult.error || 'Could not load the medicine catalog.')
      if (!categoriesResponse.ok) throw new Error(categoriesResult.error || 'Could not load medicine categories.')
      if (!pharmaciesResponse.ok) throw new Error(pharmaciesResult.error || 'Could not load pharmacies.')
      setProducts((medicinesResult as InventoryRecord[]).map((item) => ({
        id: item.id,
        pharmacyId: item.pharmacyId,
        pharmacyName: item.pharmacyName,
        name: item.name,
        brandName: item.brandName,
        genericName: item.genericName,
        strength: item.strength,
        dosageForm: item.dosageForm,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        deliveryFee: item.deliveryFee,
        pickupAvailable: item.pickupAvailable,
        category: item.category,
        pack: item.pack,
        price: item.price,
        stock: item.stock,
        image: item.imageUrl || '/pharma-plus-icon.png',
        description: item.description || '',
        rating: item.rating,
        reviewCount: item.reviewCount,
        prescriptionRequired: item.prescriptionRequired,
      })))
      setStoreCategories((categoriesResult as Array<{ name: string }>).map(({ name }) => ({
        name,
        icon: categories.find((category) => category.name === name)?.icon ?? '💊',
      })))
      setPharmacies(pharmaciesResult as PharmacyChoice[])
      setCatalogError('')
    } catch (requestError) {
      setCatalogError(requestError instanceof Error ? requestError.message : 'Could not load the medicine catalog.')
    }
  }

  useEffect(() => {
    // Load the catalog from the PostgreSQL-backed API when the app mounts.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshCatalog()
  }, [])

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [cart],
  )

  const handleAddToCart = (product: Product, quantity: number) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(product.pharmacyId) || product.pharmacyId < 1) {
      setCartError('Choose a valid medicine quantity and pharmacy.')
      return false
    }
    if (product.stock < 1 || quantity > product.stock) {
      setCartError(`Only ${Math.max(0, product.stock)} pack(s) are currently available for ${product.name}. Refresh stock before adding more.`)
      return false
    }
    if (cart.some((item) => item.pharmacy_id !== product.pharmacyId)) {
      setCartError('Your cart contains medicines from another pharmacy. Place that order first or clear your cart.')
      return false
    }
    const existing = cart.find((item) => item.id === product.id)
    if (existing && existing.quantity + quantity > product.stock) {
      setCartError(`Only ${Math.max(0, product.stock - existing.quantity)} additional pack(s) of ${product.name} are currently available.`)
      return false
    }
    setCartError('')
    setCart((current) => {
      const currentItem = current.find((item) => item.id === product.id)
      if (currentItem) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(item.stock, item.quantity + quantity) } : item,
        )
      }
      return [...current, { ...product, pharmacy_id: product.pharmacyId, quantity: Math.min(product.stock, quantity) }]
    })
    return true
  }

  const updateCartQuantity = (id: number, adjustment: number) => {
    setCart((current) =>
      current
        .filter((item) => item.id !== id || item.quantity + adjustment > 0)
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.min(item.stock, Math.max(1, item.quantity + adjustment)) } : item,
        ),
    )
  }

  const total = subtotal + (cart[0]?.deliveryFee ?? 0) +
    (subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0)

  return (
    <BrowserRouter>
      <ApplicationRoutes
        cart={cart}
        catalogError={catalogError}
        categories={storeCategories}
        onAddToCart={handleAddToCart}
        onClearCart={() => setCart([])}
        cartError={cartError}
        onCatalogChange={() => void refreshCatalog()}
        onSelectPharmacy={setSelectedPharmacyId}
        onSelectCategory={setSelectedCategory}
        onUpdateCartQuantity={updateCartQuantity}
        paymentMethod={paymentMethod}
        pharmacies={pharmacies}
        products={products}
        selectedCategory={selectedCategory}
        selectedPharmacyId={selectedPharmacyId}
        setPaymentMethod={setPaymentMethod}
        total={total}
        subtotal={subtotal}
      />
    </BrowserRouter>
  )
}

type ApplicationRoutesProps = {
  cart: CartItem[]
  cartError: string
  catalogError: string
  categories: Array<{ name: string; icon: string }>
  onAddToCart: (product: Product, quantity: number) => boolean
  onClearCart: () => void
  onCatalogChange: () => void
  onSelectPharmacy: (value: string) => void
  onSelectCategory: (value: string) => void
  onUpdateCartQuantity: (id: number, adjustment: number) => void
  paymentMethod: string
  pharmacies: PharmacyChoice[]
  products: Product[]
  selectedCategory: string
  selectedPharmacyId: string
  setPaymentMethod: (value: string) => void
  subtotal: number
  total: number
}

function ApplicationRoutes({
  cart,
  cartError,
  catalogError,
  categories: storeCategories,
  onAddToCart,
  onClearCart,
  onCatalogChange,
  onSelectPharmacy,
  onSelectCategory,
  onUpdateCartQuantity,
  paymentMethod,
  pharmacies,
  products,
  selectedCategory,
  selectedPharmacyId,
  setPaymentMethod,
  subtotal,
  total,
}: ApplicationRoutesProps) {
  const navigate = useNavigate()
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])
  const [favoritesError, setFavoritesError] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadFavorites = async () => {
      if (!accountSession || accountSession.user.role !== 'customer') {
        setFavoriteIds([])
        return
      }
      try {
        const response = await authenticatedApiFetch('/api/me/favorites', accountSession.token)
        const result = await response.json() as { medicineIds?: number[]; error?: string }
        if (!response.ok) throw new Error(result.error || 'Could not load your favorites.')
        if (!cancelled) {
          setFavoriteIds(result.medicineIds ?? [])
          setFavoritesError('')
        }
      } catch (requestError) {
        if (!cancelled) setFavoritesError(requestError instanceof Error ? requestError.message : 'Could not load your favorites.')
      }
    }
    // Load server-persisted favorites when the customer session is restored or changed.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadFavorites()
    return () => { cancelled = true }
  }, [accountSession])

  const toggleFavorite = async (medicineId: number): Promise<boolean> => {
    if (!accountSession || accountSession.user.role !== 'customer') {
      setFavoritesError('Sign in with a customer account to save favorites.')
      return false
    }
    setFavoritesError('')
    const removing = favoriteIds.includes(medicineId)
    try {
      const response = await authenticatedApiFetch(
        removing ? `/api/me/favorites/${medicineId}` : '/api/me/favorites',
        accountSession.token,
        removing
          ? { method: 'DELETE' }
          : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medicineId }) },
      )
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not update your favorites.')
      setFavoriteIds((current) => removing
        ? current.filter((id) => id !== medicineId)
        : current.includes(medicineId) ? current : [...current, medicineId])
      return true
    } catch (requestError) {
      setFavoritesError(requestError instanceof Error ? requestError.message : 'Could not update your favorites.')
      return false
    }
  }
  const onToggleFavorite = toggleFavorite

  useEffect(() => {
    let cancelled = false
    const restoreSession = async () => {
      const token = sessionStorageToken()
      if (!token) {
        setAuthReady(true)
        return
      }
      try {
        const response = await authenticatedApiFetch('/api/auth/session', token)
        const result = await response.json() as SessionResponse
        if (response.status === 401) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
          return
        }
        if (!response.ok) throw new Error(result.error || 'Could not restore your sign-in.')
        if (!cancelled) setAccountSession({ token, user: result.user })
      } catch (requestError) {
        if (!cancelled) setAuthError(requestError instanceof Error ? requestError.message : 'Could not restore your sign-in.')
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }
    // Restore the signed-in role before exposing either workspace.
    // oxlint-disable-next-line react/set-state-in-effect
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const handleAuthenticated = (session: AccountSession) => {
    saveAccountSession(session)
    setAccountSession(session)
    setAuthError('')
    navigate(session.user.role === 'pharmacy_owner' ? '/dashboard' : '/', { replace: true })
  }

  const signOut = async () => {
    if (accountSession) {
      try {
        const response = await authenticatedApiFetch('/api/auth/logout', accountSession.token, { method: 'POST' })
        if (!response.ok) throw new Error('The server could not end this session.')
      } catch (requestError) {
        setAuthError(requestError instanceof Error ? requestError.message : 'Could not end this session.')
      }
    }
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setAccountSession(null)
    navigate('/welcome', { replace: true })
  }

  if (!authReady) {
    return (
      <div className="app-shell auth-shell">
        <div className="app-frame auth-frame">
          <main className="auth-loading" role="status">Connecting to your account…</main>
        </div>
      </div>
    )
  }

  if (!accountSession) {
    return (
      <div className="app-shell auth-shell">
        <div className="app-frame auth-frame">
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/account-type" element={<AccountTypeSelectionPage />} />
            <Route path="/auth" element={<AuthenticationPage onAuthenticated={handleAuthenticated} connectionError={authError} />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </Routes>
        </div>
      </div>
    )
  }

  if (accountSession.user.role === 'admin') {
    return <AdminPage session={accountSession} onSignOut={() => void signOut()} />
  }

  if (accountSession.user.role === 'pharmacy_owner') {
    return (
      <div className="app-shell owner-app-shell">
        <div className="app-frame owner-app-frame">
          <Routes>
            <Route path="/dashboard/orders/:orderId" element={<DashboardPage ownerSession={accountSession} onCatalogChange={onCatalogChange} onSignOut={() => void signOut()} />} />
            <Route
              path="/dashboard/:section?"
              element={<DashboardPage ownerSession={accountSession} onCatalogChange={onCatalogChange} onSignOut={() => void signOut()} />}
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <Routes>
          <Route
            path="/"
            element={
              <CustomerHomePage
                session={accountSession}
                categories={storeCategories}
                products={products}
                pharmacies={pharmacies}
                selectedPharmacyId={selectedPharmacyId}
                onSelectPharmacy={onSelectPharmacy}
                selectedCategory={selectedCategory}
                onSelectCategory={onSelectCategory}
                favoriteIds={favoriteIds}
                onToggleFavorite={onToggleFavorite}
                favoritesError={favoritesError}
                catalogError={catalogError}
              />
            }
          />
          <Route
            path="/favorites"
            element={
              <CustomerCollectionPage
                title="Your Favorites"
                description="Your saved wellness essentials, all in one place."
                products={products.filter((product) => favoriteIds.includes(product.id))}
                onToggleFavorite={onToggleFavorite}
                favoritesError={favoritesError}
                emptyMessage="Products you save will appear here."
              />
            }
          />
          <Route
            path="/cart"
            element={
              <CustomerCartPage
                cart={cart}
                cartError={cartError}
                subtotal={subtotal}
                total={total}
                updateCartQuantity={onUpdateCartQuantity}
              />
            }
          />
          <Route
            path="/compare/:id"
            element={
              <CustomerProductComparePage
                products={products}
                session={accountSession}
                onAddToCart={onAddToCart}
              />
            }
          />
          <Route path="/orders/:orderId" element={<CustomerOrderTrackingPage session={accountSession} />} />
          <Route path="/orders" element={<CustomerOrdersPage session={accountSession} />} />
          <Route path="/profile" element={<CustomerProfilePage session={accountSession} onSignOut={() => void signOut()} />} />
          <Route path="/product/:id/reviews" element={
            <ProductDetailPage
              products={products}
              session={accountSession}
              onAddToCart={onAddToCart}
              onToggleFavorite={onToggleFavorite}
              favoriteIds={favoriteIds}
              favoritesError={favoritesError}
              onReviewsChanged={onCatalogChange}
              reviewsOnly
            />
          } />
          <Route path="/product/:id" element={
            <ProductDetailPage
              products={products}
              session={accountSession}
              onAddToCart={onAddToCart}
              onToggleFavorite={onToggleFavorite}
              favoriteIds={favoriteIds}
              favoritesError={favoritesError}
              onReviewsChanged={onCatalogChange}
            />
          } />
          <Route
            path="/checkout"
            element={
              <CheckoutPage
                cart={cart}
                cartError={cartError}
                session={accountSession}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                onClearCart={onClearCart}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function CustomerHomePage({
  session,
  categories,
  products,
  pharmacies,
  selectedPharmacyId,
  onSelectPharmacy,
  selectedCategory,
  onSelectCategory,
  favoriteIds,
  onToggleFavorite,
  favoritesError,
  catalogError,
}: {
  session: AccountSession
  categories: Array<{ name: string; icon: string }>
  products: Product[]
  pharmacies: PharmacyChoice[]
  selectedPharmacyId: string
  onSelectPharmacy: (value: string) => void
  selectedCategory: string
  onSelectCategory: (value: string) => void
  favoriteIds: number[]
  onToggleFavorite: (productId: number) => Promise<boolean>
  favoritesError: string
  catalogError: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [pharmacyQuery, setPharmacyQuery] = useState('')
  const [pharmacyPickerOpen, setPharmacyPickerOpen] = useState(false)
  const [notificationCount, setNotificationCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')
  const [profilePhoto] = useState(() => localStorage.getItem(`pharma-plus-profile-photo-${session.user.id}`) || '')
  const [greeting] = useState(() => {
    const hour = new Date().getHours()
    return hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening'
  })
  const filteredProducts = products.filter((product) => {
    const matchesPharmacy = !selectedPharmacyId || product.pharmacyId === Number(selectedPharmacyId)
    const matchesCategory = selectedCategory === 'All medicines' || product.category === selectedCategory
    const matchesQuery = !query.trim() || `${product.name} ${product.brandName ?? ''} ${product.genericName ?? ''} ${product.strength ?? ''} ${product.dosageForm ?? ''} ${product.category} ${product.pharmacyName}`.toLowerCase().includes(query.trim().toLowerCase())
    return matchesPharmacy && matchesCategory && matchesQuery
  })
  const pharmacyOptions = pharmacies.filter((pharmacy) =>
    pharmacy.name.toLowerCase().includes(pharmacyQuery.trim().toLowerCase()),
  )

  useEffect(() => {
    let cancelled = false
    const loadNotifications = async () => {
      try {
        const response = await authenticatedApiFetch('/api/customer/orders', session.token)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load notifications.')
        if (!cancelled) {
          setNotificationCount((result as CustomerOrder[]).filter((order) => !['delivered', 'declined', 'cancelled'].includes(order.status)).length)
          setNotificationError('')
        }
      } catch (requestError) {
        if (!cancelled) setNotificationError(requestError instanceof Error ? requestError.message : 'Could not load notifications.')
      }
    }
    void loadNotifications()
    const timer = window.setInterval(() => void loadNotifications(), 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [session.token])

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen customer-screen">
      <header className="topbar customer-topbar">
        <button type="button" className="home-menu-button" onClick={() => navigate('/profile')} aria-label="Open profile">
          <span className="customer-initial-avatar" aria-hidden="true">
            {profilePhoto ? <img src={profilePhoto} alt="" /> : session.user.fullName.trim().charAt(0).toUpperCase() || 'U'}
          </span>
        </button>
        <div className="home-brand"><span className="brand-mark">P+</span><strong>Pharma <span>Plus</span></strong></div>
        <div className="home-header-actions">
          <button type="button" className="icon-button notification-button" aria-label={`Notifications${notificationCount ? `, ${notificationCount} active orders` : ''}`} onClick={() => navigate('/orders')}>
            <Bell className="icon" />
            {notificationCount > 0 && <span className="notification-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
          </button>
          <button type="button" className="icon-button" aria-label="Open favorites" onClick={() => navigate('/favorites')}><Heart className="icon" /></button>
        </div>
      </header>

      <section className="hero-copy">
        <small>{greeting}, {session.user.fullName.split(' ')[0]}</small>
        <h1>Your health essentials,<br /><span className="light">close to home.</span></h1>
      </section>
      {notificationError && <p className="owner-form-error" role="status">{notificationError}</p>}

      <div className="search-row">
        <div className="search-field">
          <Search className="search-icon" />
          <input type="search" placeholder="Search medicines..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button className="search-action" aria-label="Search">
          <Camera className="icon" />
        </button>
      </div>

      <section className="section-block">
        <div className="section-header">
          <h3>Categories</h3>
          <button type="button" onClick={() => onSelectCategory('All medicines')}>See All</button>
        </div>
        <div className="pill-row horizontal-scroll">
          <button
            className={selectedCategory === 'All medicines' ? 'category-pill active' : 'category-pill'}
            onClick={() => onSelectCategory('All medicines')}
          >
            <span className="category-icon">🛍️</span>
            <span>All medicines</span>
          </button>
          {categories.map((category) => (
            <button
              key={category.name}
              className={selectedCategory === category.name ? 'category-pill active' : 'category-pill'}
              onClick={() => onSelectCategory(category.name)}
            >
              <span className="category-icon">{category.icon}</span>
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-header pharmacy-section-header">
          <div><h3>Select pharmacy</h3><small>Browse every store or choose one nearby</small></div>
          <div className="pharmacy-picker">
            <button type="button" className="pharmacy-picker-trigger" aria-expanded={pharmacyPickerOpen} onClick={() => setPharmacyPickerOpen((open) => !open)}>
              <MapPin className="icon" />
              <span>{pharmacies.find((pharmacy) => String(pharmacy.id) === selectedPharmacyId)?.name ?? 'All pharmacies'}</span>
              <span className="pharmacy-picker-chevron">⌄</span>
            </button>
            {pharmacyPickerOpen && (
              <div className="pharmacy-picker-menu">
                <label className="pharmacy-picker-search"><Search className="icon" /><input autoFocus placeholder="Search pharmacy name" value={pharmacyQuery} onChange={(event) => setPharmacyQuery(event.target.value)} /></label>
                <button type="button" className={!selectedPharmacyId ? 'pharmacy-option selected' : 'pharmacy-option'} onClick={() => {
                  onSelectPharmacy('')
                  setPharmacyQuery('')
                  setPharmacyPickerOpen(false)
                }}>All pharmacies <small>Browse every store</small></button>
                {pharmacyOptions.map((pharmacy) => (
                  <button type="button" key={pharmacy.id} className={selectedPharmacyId === String(pharmacy.id) ? 'pharmacy-option selected' : 'pharmacy-option'} onClick={() => {
                    onSelectPharmacy(String(pharmacy.id))
                    setPharmacyQuery('')
                    setPharmacyPickerOpen(false)
                  }}>
                    {pharmacy.name}<small>{[pharmacy.city, pharmacy.state].filter(Boolean).join(', ') || 'Local pharmacy'}</small>
                  </button>
                ))}
                {pharmacyOptions.length === 0 && <p className="pharmacy-option-empty">No pharmacy matches that name.</p>}
              </div>
            )}
          </div>
        </div>
        {catalogError && <p className="owner-form-error" role="alert">{catalogError}</p>}
        {favoritesError && <p className="owner-form-error" role="alert">{favoritesError}</p>}
      </section>

      <section className="home-promo-banner">
        <div><small>EVERYDAY HEALTH ESSENTIALS</small><h2>Care from your<br />neighborhood pharmacy</h2><button type="button" onClick={() => onSelectCategory('All medicines')}>Shop now <ArrowUpRight className="icon" /></button></div>
        <span className="promo-bag" aria-hidden="true"><Plus className="icon" /><Pill className="icon" /></span>
      </section>

      <section className="section-block">
        <div className="section-header">
          <div><h3>Explore pharmacy listings</h3><small>Products currently listed by verified pharmacies</small></div>
          <button type="button" onClick={() => onSelectCategory('All medicines')}>See all</button>
        </div>
        <div className="product-row horizontal-scroll">
          {filteredProducts.map((product) => (
            <motion.article
              key={product.id}
              whileHover={{ y: -4, scale: 1.01 }}
              className="product-card"
              onClick={() => navigate(`/product/${product.id}`)}
            >
              {product.badge ? <span className="discount-badge">{product.badge}</span> : null}
              <button
                className={favoriteIds.includes(product.id) ? 'wish-button selected' : 'wish-button'}
                aria-label={favoriteIds.includes(product.id) ? 'Remove from favorites' : 'Add to favorites'}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFavorite(product.id)
                }}
              >
                <Heart className="icon" />
              </button>
              <img src={product.image} alt={product.name} />
              <div className="product-copy">
                <h4>{product.name}</h4>
                <small>{product.category} · {product.pharmacyName}</small>
                {product.description && <p className="product-short-description">{product.description}</p>}
                {product.rating ? <span className="catalog-rating"><Star className="star-icon" /> {product.rating.toFixed(1)}{product.reviewCount ? ` (${product.reviewCount})` : ''}</span> : null}
                <div className="price-row-card">
                  <strong>₹{product.price.toLocaleString('en-IN')}</strong>
                  <button className="mini-arrow" aria-label={`View ${product.name}`}>
                    <ArrowUpRight className="icon" />
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
          {filteredProducts.length === 0 && !catalogError && <p className="empty-state-card compact-empty">{products.length ? 'No medicines match these filters.' : 'No medicines are listed yet. The pharmacy owner can add products from the dashboard.'}</p>}
        </div>
      </section>

      <CustomerBottomNav />
    </motion.div>
  )
}

function CustomerBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const navIcons = [Home, Search, Heart, ShoppingBag, User]
  const navPaths = ['/', '/?focus=search', '/favorites', '/cart', '/profile']

  return (
    <nav className="bottom-nav" aria-label="Customer navigation">
      {customerTabs.map((tab, index) => {
        const Icon = navIcons[index]
        const active = tab === 'Home'
          ? location.pathname === '/' && location.search === ''
          : tab === 'Search'
            ? location.pathname === '/' && new URLSearchParams(location.search).get('focus') === 'search'
            : location.pathname === navPaths[index]
        return (
          <button
            key={tab}
            type="button"
            className={active ? 'bottom-nav-item active' : 'bottom-nav-item'}
            onClick={() => navigate(navPaths[index])}
          >
            <span className="nav-icon-wrap">
              <Icon className="icon" />
            </span>
            <span>{tab}</span>
          </button>
        )
      })}
    </nav>
  )
}

function CustomerCollectionPage({
  title,
  description,
  products,
  onToggleFavorite,
  favoritesError,
  emptyMessage,
}: {
  title: string
  description: string
  products: Product[]
  onToggleFavorite: (productId: number) => Promise<boolean>
  favoritesError: string
  emptyMessage: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const visibleProducts = products.filter((product) =>
    `${product.name} ${product.brandName ?? ''} ${product.genericName ?? ''} ${product.strength ?? ''} ${product.dosageForm ?? ''} ${product.category} ${product.pharmacyName}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback="/" />
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <label className="search-field collection-search"><Search className="search-icon" /><input type="search" placeholder="Search within favorites…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {favoritesError && <p className="owner-form-error" role="alert">{favoritesError}</p>}
      {visibleProducts.length > 0 ? (
        <div className="customer-product-grid">
          {visibleProducts.map((product) => (
            <article key={product.id} className="customer-product-card" onClick={() => navigate(`/product/${product.id}`)}>
              <button
                className="wish-button selected"
                aria-label="Remove from favorites"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFavorite(product.id)
                }}
              >
                <Heart className="icon" />
              </button>
              <img src={product.image} alt={product.name} />
              <div>
                <h3>{product.name}</h3>
                <p>{product.pharmacyName} · {product.pack}</p>
                {product.rating ? <span className="catalog-rating"><Star className="star-icon" /> {product.rating.toFixed(1)}{product.reviewCount ? ` (${product.reviewCount})` : ''}</span> : null}
                <strong>₹{product.price.toLocaleString('en-IN')}</strong>
                <button type="button" className="mini-cart-button" onClick={(event) => {
                  event.stopPropagation()
                  navigate(`/compare/${product.id}`)
                }} aria-label={`Compare pharmacies for ${product.name}`}>
                  <ShoppingBag className="icon" /> Compare & choose pharmacy
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state-card">
          <Heart className="empty-state-icon" />
          <h2>Nothing saved yet</h2>
          <p>{emptyMessage}</p>
          <NavLink to="/" className="text-action">Browse medicines</NavLink>
        </div>
      )}
      <CustomerBottomNav />
    </motion.main>
  )
}

function CustomerCartPage({
  cart,
  cartError,
  subtotal,
  total,
  updateCartQuantity,
}: {
  cart: CartItem[]
  cartError: string
  subtotal: number
  total: number
  updateCartQuantity: (id: number, adjustment: number) => void
}) {
  const navigate = useNavigate()
  const pharmacyName = cart[0]?.pharmacyName

  return (
    <motion.main className="screen customer-page-screen cart-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback="/" />
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>Your Cart</h1>
        <p>Review your medicines before checkout.</p>
      </header>
      {cartError && <p className="owner-form-error" role="alert">{cartError}</p>}
      {cart.length ? (
        <>
          <section className="cart-pharmacy-card">
            <span className="cart-pharmacy-icon"><PackageCheck className="icon" /></span>
            <div><small>ORDERING FROM</small><strong>{pharmacyName}</strong></div>
            <CircleCheck className="icon cart-ready-icon" />
          </section>
          <p className="cart-pharmacy-notice">Medicines from different pharmacies need separate orders.</p>
          <section className="cart-items-section">
            <h2>Cart items <span>{cart.length}</span></h2>
            <div className="items-stack">
              {cart.map((item) => (
                <article className="cart-item-card" key={item.id}>
                  <img src={item.image} alt={item.name} />
                  <div className="cart-copy">
                    <h4>{item.name}</h4>
                    <small>{item.pack} · {item.quantity} pack(s){item.packQuantity && item.packUnit ? ` / ${item.quantity * item.packQuantity} ${item.packUnit}` : ''}</small>
                    <strong>₹{item.price.toLocaleString('en-IN')} / pack</strong>
                  </div>
                  <div className="mini-quantity">
                    <button type="button" onClick={() => updateCartQuantity(item.id, -1)} aria-label={`Decrease ${item.name} quantity`}><Minus className="icon" /></button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => updateCartQuantity(item.id, 1)} aria-label={`Increase ${item.name} quantity`}><Plus className="icon" /></button>
                  </div>
                  <button type="button" className="delete-btn" onClick={() => updateCartQuantity(item.id, -item.quantity)} aria-label={`Remove ${item.name}`}><X className="icon" /></button>
                </article>
              ))}
            </div>
          </section>
          <section className="cart-context-card">
            <div><MapPin className="icon" /><span><strong>Delivery details</strong><small>Choose or update your address at checkout.</small></span><button type="button" onClick={() => navigate('/profile')}>Edit</button></div>
            <div><Truck className="icon" /><span><strong>Delivery or pickup</strong><small>Availability and fees are confirmed at checkout.</small></span></div>
          </section>
          <section className="cart-total-card">
            <div><span>Subtotal</span><strong>₹{subtotal.toLocaleString('en-IN')}</strong></div>
            <div><span>Disclosed delivery fee</span><strong>{cart[0]?.deliveryFee === null || cart[0]?.deliveryFee === undefined ? 'Not provided' : `₹${cart[0].deliveryFee.toLocaleString('en-IN')}`}</strong></div>
            <div><span>Tax estimate</span><strong>₹{(subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0).toLocaleString('en-IN')}</strong></div>
            <div className="cart-total-row"><span>Estimated total</span><strong>₹{total.toLocaleString('en-IN')}</strong></div>
          </section>
          <button type="button" className="accept-action checkout-next-button" onClick={() => navigate('/checkout')}>
            Proceed to checkout <ArrowUpRight className="icon" />
          </button>
        </>
      ) : (
        <div className="empty-state-card checkout-empty">
          <ShoppingBag className="empty-state-icon" />
          <h2>Your cart is empty</h2>
          <p>Choose medicines from a local pharmacy to continue.</p>
          <button type="button" className="accept-action" onClick={() => navigate('/')}>Browse medicines</button>
        </div>
      )}
      <CustomerBottomNav />
    </motion.main>
  )
}

function BackButton({ fallback = '/' }: { fallback?: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="page-back-button" onClick={() => {
      if (window.history.state?.idx > 0) navigate(-1)
      else navigate(fallback)
    }}>
      <ArrowLeft className="icon" /> <span>Back</span>
    </button>
  )
}

const orderSteps = ['pending', 'accepted', 'preparing', 'out_for_delivery', 'delivered']
const orderStatusLabel: Record<string, string> = {
  pending: 'Order placed',
  accepted: 'Accepted by pharmacy',
  preparing: 'Packed and ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

function OrderTimeline({ order }: { order: CustomerOrder }) {
  return (
    <div className="order-timeline" aria-label="Order status timeline">
      {orderSteps.map((status) => {
        const event = order.events.find((entry) => entry.status === status)
        const reached = Boolean(event)
        const active = order.status === status
        return (
          <div className={`order-timeline-step ${reached ? 'reached' : ''} ${active ? 'current' : ''}`} key={status}>
            <span className="order-timeline-marker">{reached ? <Check className="icon" /> : null}</span>
            <div><strong>{orderStatusLabel[status]}</strong>{event && <small>{new Date(event.createdAt).toLocaleString()}</small>}</div>
          </div>
        )
      })}
      {['declined', 'cancelled'].includes(order.status) && (
        <div className="order-timeline-step reached current">
          <span className="order-timeline-marker"><X className="icon" /></span>
          <div><strong>{orderStatusLabel[order.status]}</strong>{order.events.at(-1) && <small>{new Date(order.events.at(-1)!.createdAt).toLocaleString()}</small>}</div>
        </div>
      )}
    </div>
  )
}

function CustomerOrdersPage({ session }: { session: AccountSession }) {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'delivered'>('all')

  const loadOrders = useCallback(async () => {
    try {
      const response = await authenticatedApiFetch('/api/customer/orders', session.token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load your orders.')
      const nextOrders = result as CustomerOrder[]
      setOrders(nextOrders)
      setError('')
      for (const order of nextOrders) {
        if (order.status === 'delivered') localStorage.removeItem(`pharma-plus-delivery-otp-${session.user.id}-${order.id}`)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load your orders.')
    } finally {
      setLoading(false)
    }
  }, [session.token, session.user.id])

  useEffect(() => {
    // Keep order status and delivery notifications current while this page is open.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadOrders()
    const timer = window.setInterval(() => void loadOrders(), 15000)
    return () => window.clearInterval(timer)
  }, [loadOrders])

  const visibleOrders = orders.filter((order) => {
    if (filter === 'active') return !['delivered', 'declined', 'cancelled'].includes(order.status)
    if (filter === 'delivered') return order.status === 'delivered'
    return true
  })

  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback="/" />
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>My Orders</h1>
        <p>Delivery updates and order history for {session.user.fullName}.</p>
      </header>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      <div className="order-filter-tabs" role="group" aria-label="Filter orders">
        {(['all', 'active', 'delivered'] as const).map((value) => (
          <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All orders' : value === 'active' ? 'Active' : 'Delivered'}
          </button>
        ))}
      </div>
      {loading ? <div className="empty-state-card compact-empty">Loading your orders…</div> : visibleOrders.length ? (
        <div className="customer-orders-list">
          {visibleOrders.map((order) => {
            const otp = localStorage.getItem(`pharma-plus-delivery-otp-${session.user.id}-${order.id}`)
            return (
              <article className="customer-order-card" key={order.id}>
                <header className="customer-order-header">
                  <div><small>DELIVERY ID</small><strong>{order.orderNumber}</strong></div>
                  <span className={`order-status-pill ${order.status}`}>{orderStatusLabel[order.status] ?? order.status}</span>
                </header>
                <p className="customer-order-pharmacy">{order.pharmacyName} · {new Date(order.createdAt).toLocaleString()}</p>
                {order.paymentMethod === 'UPI Payment' && order.paymentStatus === 'pending' && <p className="checkout-quote-prompt">UPI payment is pending; it is not considered paid until verified by a payment gateway.</p>}
                <div className="customer-order-items">
                  {order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {formatOrderItemQuantity(item)}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}
                </div>
                <div className="customer-order-total"><span>Total</span><strong>₹{order.total.toLocaleString('en-IN')}</strong></div>
                <OrderTimeline order={order} />
                <button type="button" className="track-order-button" onClick={() => navigate(`/orders/${order.id}`)}>View tracking <ArrowUpRight className="icon" /></button>
                {order.status === 'out_for_delivery' && otp && (
                  <div className="delivery-otp-card"><span>Share this delivery code with your pharmacy</span><strong>{otp}</strong><small>Only share when your order arrives.</small></div>
                )}
                <p className="customer-order-address"><MapPin className="icon" /> {order.fulfillmentMethod === 'pickup' ? 'Pharmacy pickup' : formatOrderLocation(order)}</p>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state-card orders-empty-state">
          <span className="empty-state-icon-wrap"><Package className="icon" /></span>
          <h2>{orders.length ? 'No matching orders' : 'No orders yet'}</h2>
          <p>{orders.length ? 'Try another order filter.' : 'Your orders will show here after you place one with a pharmacy.'}</p>
          {!orders.length && <NavLink to="/" className="accept-action">Browse medicines</NavLink>}
        </div>
      )}
      <CustomerBottomNav />
    </motion.main>
  )
}

function CustomerProductComparePage({
  products,
  session,
  onAddToCart,
}: {
  products: Product[]
  session: AccountSession
  onAddToCart: (product: Product, quantity: number) => boolean
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const product = products.find((item) => item.id === Number(id))
  const [comparison, setComparison] = useState<ProductComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationNotice, setLocationNotice] = useState('')
  const [quantity, setQuantity] = useState(() => {
    const state = location.state as { quantity?: unknown } | null
    return typeof state?.quantity === 'number' && Number.isSafeInteger(state.quantity) && state.quantity > 0
      ? state.quantity
      : 1
  })
  const [cartError, setCartError] = useState('')
  const [pharmacyDetailId, setPharmacyDetailId] = useState<number | null>(null)
  const [pharmacyDetails, setPharmacyDetails] = useState<Record<number, { phone: string | null; address: string | null; distanceKm: number | null }>>({})
  const [detailError, setDetailError] = useState('')
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    if (!product) return
    let cancelled = false
    const loadComparison = async () => {
      setLoading(true)
      setError('')
      setLocationNotice('')
      let coordinates: { latitude: number; longitude: number } | null = null
      try {
        const profileResponse = await authenticatedApiFetch('/api/customer/profile', session.token)
        const profile = await profileResponse.json() as CustomerProfile & { error?: string }
        if (!profileResponse.ok) throw new Error(profile.error || 'Could not load your saved location.')
        const savedLocation = profile.addresses.find((address) => address.latitude !== null && address.longitude !== null)
        if (savedLocation && Number.isFinite(savedLocation.latitude) && Number.isFinite(savedLocation.longitude)) {
          coordinates = { latitude: savedLocation.latitude!, longitude: savedLocation.longitude! }
        }
      } catch (requestError) {
        if (!cancelled) setLocationNotice(requestError instanceof Error ? requestError.message : 'Could not load your saved location.')
      }
      if (cancelled) return
      setOrigin(coordinates)
      try {
        const params = new URLSearchParams({ productKey: String(product.id) })
        if (coordinates) {
          params.set('latitude', String(coordinates.latitude))
          params.set('longitude', String(coordinates.longitude))
        }
        const response = await fetch(apiUrl(`/api/catalog/compare?${params.toString()}`))
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not compare pharmacy listings.')
        if (!cancelled) setComparison(result as ProductComparison)
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not compare pharmacy listings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    // Load only exact-identity matches for the selected product listing.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadComparison()
    return () => { cancelled = true }
  }, [product, session.token])

  const loadPharmacyDetails = async (pharmacyId: number) => {
    if (pharmacyDetailId === pharmacyId) {
      setPharmacyDetailId(null)
      return
    }
    setDetailError('')
    try {
      const params = new URLSearchParams()
      if (origin) {
        params.set('latitude', String(origin.latitude))
        params.set('longitude', String(origin.longitude))
      }
      const query = params.size ? `?${params.toString()}` : ''
      const response = await fetch(apiUrl(`/api/pharmacies/${pharmacyId}${query}`))
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load pharmacy details.')
      setPharmacyDetails((current) => ({ ...current, [pharmacyId]: result }))
      setPharmacyDetailId(pharmacyId)
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Could not load pharmacy details.')
    }
  }

  const choosePharmacy = (listing: ProductComparisonListing) => {
    setCartError('')
    const selectedProduct: Product = {
      id: listing.medicineId,
      pharmacyId: listing.pharmacyId,
      pharmacyName: listing.pharmacyName,
      name: listing.name,
      brandName: listing.brandName,
      genericName: listing.genericName,
      strength: listing.strength,
      dosageForm: listing.dosageForm,
      packQuantity: listing.packQuantity,
      packUnit: listing.packUnit,
      deliveryFee: listing.deliveryFee,
      pickupAvailable: listing.pickupAvailable,
      category: listing.category,
      pack: listing.pack,
      price: listing.price,
      stock: listing.availableStock,
      prescriptionRequired: listing.prescriptionRequired,
      image: listing.imageUrl || '/pharma-plus-icon.png',
      description: listing.description || '',
    }
    if (!onAddToCart(selectedProduct, quantity)) {
      setCartError('Could not add this item. Check that the cart contains one pharmacy and the selected quantity is still available.')
      return
    }
    navigate('/cart')
  }

  if (!product) {
    return (
      <main className="screen customer-page-screen">
        <div className="empty-state-card"><h2>Medicine not found</h2><p>This listing may no longer be available.</p><button type="button" className="accept-action" onClick={() => navigate('/')}>Back to medicines</button></div>
        <CustomerBottomNav />
      </main>
    )
  }

  return (
    <motion.main className="screen customer-page-screen compare-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback={`/product/${product.id}`} />
        <p className="eyebrow">VERIFIED PHARMACY LISTINGS</p>
        <h1>Compare exact product</h1>
        <p>Choose one verified pharmacy before adding this medicine to your cart.</p>
      </header>
      <section className="compare-product-identity">
        <img src={product.image} alt="" />
        <div>
          <strong>{product.name}</strong>
          <span>{product.brandName || 'Brand not recorded'} · {product.genericName || 'Generic ingredient not recorded'}</span>
          <span>{product.strength || 'Strength not recorded'} · {product.dosageForm || 'Dosage form not recorded'}</span>
          <span>Pack: {product.packQuantity && product.packUnit ? `${product.packQuantity} ${product.packUnit}` : product.pack || 'Dimensions not recorded'}</span>
        </div>
      </section>
      {locationNotice && <p className="compare-location-notice" role="status">{locationNotice} Distance is not shown.</p>}
      {cartError && <p className="owner-form-error" role="alert">{cartError}</p>}
      {detailError && <p className="owner-form-error" role="alert">{detailError}</p>}
      {loading ? <div className="empty-state-card compact-empty">Finding verified pharmacy listings…</div> : null}
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {!loading && comparison && !comparison.product.identityComplete && (
        <section className="compare-safety-warning" role="alert">
          <strong>Exact product identity is incomplete</strong>
          <p>This listing is missing one or more of brand, generic ingredient, strength, dosage form, or pack dimensions. No cross-pharmacy match or substitution is shown. Ask a pharmacist to verify the product before purchasing.</p>
        </section>
      )}
      {!loading && comparison?.product.identityComplete && (
        <section className="compare-exact-criteria">
          <strong>Exact match only</strong>
          <span>Brand, generic ingredient, strength, dosage form, pack quantity, and unit must all match.</span>
        </section>
      )}
      {!loading && comparison?.product.identityComplete && comparison.listings.length === 0 && (
        <div className="empty-state-card compact-empty">No verified pharmacy currently lists this exact product identity.</div>
      )}
      {!loading && comparison?.listings.map((listing) => (
        <article className="compare-pharmacy-card" key={`${listing.pharmacyId}-${listing.medicineId}`}>
          <header><div><strong>{listing.pharmacyName}</strong><span>{[listing.city, listing.state].filter(Boolean).join(', ') || 'Verified pharmacy'}</span></div><span className={listing.available ? 'order-status-pill delivered' : 'order-status-pill pending'}>{listing.available ? `${listing.availableStock} available` : 'Out of stock'}</span></header>
          <div className="compare-price-grid">
            <div><small>Product price</small><strong>₹{listing.price.toLocaleString('en-IN')}</strong></div>
            <div><small>Delivery fee</small><strong>{listing.deliveryFee === null ? 'Not disclosed' : `₹${listing.deliveryFee.toLocaleString('en-IN')}`}</strong></div>
            <div><small>Pickup</small><strong>{listing.pickupAvailable ? 'Available' : 'Not available'}</strong></div>
            <div><small>Approx. distance</small><strong>{listing.distanceKm === null ? 'Not available' : `${listing.distanceKm} km`}</strong></div>
          </div>
          {listing.deliveryFee !== null && (
            <p className="compare-estimated-total">
              Estimated total for {quantity} (includes disclosed delivery and estimated tax): ₹{(
                listing.price * quantity + listing.deliveryFee + Math.round(listing.price * quantity * 0.05 * 100) / 100
              ).toLocaleString('en-IN')}
            </p>
          )}
          <button type="button" className="quiet-action" onClick={() => void loadPharmacyDetails(listing.pharmacyId)}>{pharmacyDetailId === listing.pharmacyId ? 'Hide pharmacy details' : 'View pharmacy details'}</button>
          {pharmacyDetailId === listing.pharmacyId && pharmacyDetails[listing.pharmacyId] && (
            <div className="compare-pharmacy-details">
              <span>{pharmacyDetails[listing.pharmacyId].address || 'Address not provided'}{listing.city ? `, ${listing.city}` : ''}</span>
              {pharmacyDetails[listing.pharmacyId].phone && <span>Phone: {pharmacyDetails[listing.pharmacyId].phone}</span>}
              <span>{pharmacyDetails[listing.pharmacyId].distanceKm === null ? 'Distance not available' : `Approx. straight-line distance: ${pharmacyDetails[listing.pharmacyId].distanceKm} km`}</span>
            </div>
          )}
          <div className="compare-quantity-control">
            <span>Quantity</span>
            <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))}><Minus className="icon" /></button>
            <strong>{quantity}</strong>
            <button type="button" aria-label="Increase quantity" disabled={quantity >= listing.availableStock} onClick={() => setQuantity((current) => Math.min(listing.availableStock, current + 1))}><Plus className="icon" /></button>
          </div>
          {listing.deliveryFee === null && <p className="compare-location-notice">{listing.pickupAvailable ? 'Delivery is unavailable until a fee is disclosed; pickup may be selected at checkout.' : 'Neither delivery nor pickup is currently available.'}</p>}
          <button type="button" className="accept-action compare-select-button" disabled={!listing.available || quantity > listing.availableStock || (listing.deliveryFee === null && !listing.pickupAvailable)} onClick={() => choosePharmacy(listing)}>
            {listing.deliveryFee === null && !listing.pickupAvailable ? 'No fulfillment option available' : `Choose ${listing.pharmacyName} and continue to cart`} <ArrowUpRight className="icon" />
          </button>
        </article>
      ))}
      {!loading && comparison?.nonIdenticalListings.length ? (
        <section className="compare-nonidentical-section">
          <h2>Other listings — not exact matches</h2>
          <p>These are not equivalent products or recommendations. Brand, strength, dosage form, or pack may differ. Do not substitute; ask a pharmacist to assess any alternative.</p>
          {comparison.nonIdenticalListings.map((listing) => (
            <article className="compare-nonidentical-card" key={`${listing.pharmacyId}-${listing.medicineId}`}>
              <span className="nonidentical-badge">NOT AN EXACT MATCH</span>
              <strong>{listing.name}</strong>
              <span>{listing.brandName || 'Brand not recorded'} · {listing.genericName || 'Generic not recorded'} · {listing.strength || 'Strength not recorded'}</span>
              <span>{listing.dosageForm || 'Form not recorded'} · {listing.packQuantity && listing.packUnit ? `${listing.packQuantity} ${listing.packUnit}` : listing.pack}</span>
              <small>{listing.pharmacyName} · {listing.available ? 'Available' : 'Out of stock'} · ₹{listing.price.toLocaleString('en-IN')}</small>
              <strong className="pharmacist-required-label">Pharmacist involvement required before considering</strong>
            </article>
          ))}
        </section>
      ) : null}
      <CustomerBottomNav />
    </motion.main>
  )
}

function CustomerOrderTrackingPage({ session }: { session: AccountSession }) {
  const { orderId } = useParams()
  const [order, setOrder] = useState<CustomerOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOrder = useCallback(async () => {
    try {
      const response = await authenticatedApiFetch('/api/customer/orders', session.token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load this order.')
      const found = (result as CustomerOrder[]).find((entry) => entry.id === Number(orderId))
      if (!found) throw new Error('This order could not be found in your account.')
      setOrder(found)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load this order.')
    } finally {
      setLoading(false)
    }
  }, [orderId, session.token])

  useEffect(() => {
    // Poll the authorized customer order list so its timeline stays current.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadOrder()
    const timer = window.setInterval(() => void loadOrder(), 15000)
    return () => window.clearInterval(timer)
  }, [loadOrder])

  const otp = order ? localStorage.getItem(`pharma-plus-delivery-otp-${session.user.id}-${order.id}`) : null

  return (
    <motion.main className="screen customer-page-screen tracking-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback="/orders" />
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>Order Tracking</h1>
        <p>Live fulfillment updates from your pharmacy.</p>
      </header>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {loading ? <div className="empty-state-card compact-empty">Loading your order…</div> : order ? (
        <>
          <section className="tracking-order-card">
            <div className="tracking-order-icon"><Truck className="icon" /></div>
            <div><small>ORDER {order.orderNumber}</small><strong>{order.pharmacyName}</strong></div>
            <span className={`order-status-pill ${order.status}`}>{orderStatusLabel[order.status] ?? order.status}</span>
          </section>
          <section className="tracking-progress-card">
            <h2>Delivery progress</h2>
            {order.paymentMethod === 'UPI Payment' && order.paymentStatus === 'pending' && <p className="checkout-quote-prompt">UPI payment is pending; it is not considered paid until verified by a payment gateway.</p>}
            <OrderTimeline order={order} />
          </section>
          {otp && order.status !== 'delivered' && (
            <section className="delivery-code-card">
              <div><span className="delivery-code-icon"><PackageCheck className="icon" /></span><div><h2>Your delivery code</h2><p>Share this only when your order is handed to you.</p></div></div>
              <strong>{otp}</strong>
            </section>
          )}
          <section className="tracking-items-card">
            <h2>Items ({order.items.length})</h2>
            {order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {formatOrderItemQuantity(item)}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}
            <div className="tracking-total"><span>Order total</span><strong>₹{order.total.toLocaleString('en-IN')}</strong></div>
          </section>
          <section className="tracking-address-card"><MapPin className="icon" /><div><strong>{order.fulfillmentMethod === 'pickup' ? 'Pickup' : 'Delivery location'}</strong><span>{formatOrderLocation(order)}</span></div></section>
        </>
      ) : null}
      <CustomerBottomNav />
    </motion.main>
  )
}

function CustomerProfilePage({
  session,
  onSignOut,
}: {
  session: AccountSession
  onSignOut: () => void
}) {
  const navigate = useNavigate()
  const photoInput = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [editingProfile, setEditingProfile] = useState(false)
  const [editingAddressId, setEditingAddressId] = useState<number | null>(null)
  const [addressEditorOpen, setAddressEditorOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm())
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddressForm())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [profilePhoto, setProfilePhoto] = useState(() => localStorage.getItem(`pharma-plus-profile-photo-${session.user.id}`) || '')

  const applyProfile = (nextProfile: CustomerProfile) => {
    setProfile(nextProfile)
    setProfileForm({
      fullName: nextProfile.user.fullName,
      phone: nextProfile.user.phone ?? '',
    })
  }

  useEffect(() => {
    let cancelled = false
    const loadProfile = async () => {
      try {
        const [profileResponse, addressesResponse] = await Promise.all([
          authenticatedApiFetch('/api/me/profile', session.token),
          authenticatedApiFetch('/api/me/addresses', session.token),
        ])
        const profileResult = await profileResponse.json()
        const addressesResult = await addressesResponse.json()
        if (!profileResponse.ok) throw new Error(profileResult.error || 'Could not load your profile.')
        if (!addressesResponse.ok) throw new Error(addressesResult.error || 'Could not load your saved addresses.')
        if (!cancelled) applyProfile({
          user: profileResult.user,
          addresses: addressesResult.addresses,
        } as CustomerProfile)
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load your profile.')
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    // oxlint-disable-next-line react/set-state-in-effect
    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [session.token])

  const refreshAddresses = async () => {
    const response = await authenticatedApiFetch('/api/me/addresses', session.token)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not refresh your saved addresses.')
    setProfile((current) => current ? { ...current, addresses: result.addresses } : current)
  }

  const captureCurrentLocation = () => {
    setError('')
    setMessage('')
    if (!navigator.geolocation) {
      setError('This device does not provide location access. Choose manual entry instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAddressForm((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }))
        setLocating(false)
        setMessage('GPS coordinates captured. No street lookup was performed.')
      },
      (locationError) => {
        const locationMessage = locationError.code === locationError.PERMISSION_DENIED
          ? 'Location permission was denied. Allow it in your device settings, try again, or enter an address manually.'
          : locationError.code === locationError.POSITION_UNAVAILABLE
            ? 'Your current location is unavailable. Try again or enter an address manually.'
            : 'Location took too long to respond. Try again or enter an address manually.'
        setError(locationMessage)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await authenticatedApiFetch('/api/me/profile', session.token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save your profile.')
      setProfile((current) => current ? { ...current, user: result.user } : current)
      setProfileForm({ fullName: result.user.fullName, phone: result.user.phone ?? '' })
      setEditingProfile(false)
      setMessage('Your profile was saved.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  const beginNewAddress = () => {
    setEditingAddressId(null)
    setAddressForm({ ...emptyAddressForm(), isDefault: !profile?.addresses.length })
    setAddressEditorOpen(true)
    setError('')
    setMessage('')
  }

  const beginEditAddress = (address: CustomerAddress) => {
    setEditingAddressId(address.id)
    setAddressForm({
      label: address.label,
      contactPhone: address.contactPhone ?? '',
      address: address.address ?? '',
      city: address.city ?? '',
      state: address.state ?? '',
      postalCode: address.postalCode ?? '',
      latitude: address.latitude,
      longitude: address.longitude,
      isDefault: address.isDefault,
    })
    setAddressEditorOpen(true)
    setError('')
    setMessage('')
  }

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await authenticatedApiFetch(
        editingAddressId === null ? '/api/me/addresses' : `/api/me/addresses/${editingAddressId}`,
        session.token,
        {
          method: editingAddressId === null ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addressForm),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this address.')
      await refreshAddresses()
      setAddressEditorOpen(false)
      setEditingAddressId(null)
      setMessage('Saved address updated.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save this address.')
    } finally {
      setBusy(false)
    }
  }

  const makeDefault = async (address: CustomerAddress) => {
    setError('')
    setMessage('')
    try {
      const response = await authenticatedApiFetch(`/api/me/addresses/${address.id}`, session.token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not set the default address.')
      await refreshAddresses()
      setMessage(`${address.label} is now your default address.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not set the default address.')
    }
  }

  const uploadProfilePhoto = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for your profile photo.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Choose an image smaller than 2 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('Could not read the selected profile image.')
        return
      }
      try {
        localStorage.setItem(`pharma-plus-profile-photo-${session.user.id}`, reader.result)
        setProfilePhoto(reader.result)
        setError('')
      } catch {
        setError('There is not enough device storage to save this image. Choose a smaller image.')
      }
    }
    reader.onerror = () => setError('Could not read the selected profile image.')
    reader.readAsDataURL(file)
  }

  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <BackButton fallback="/" />
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>My Profile</h1>
        <p>Manage your account and delivery preferences.</p>
      </header>
      {profile ? (
        <>
          <section className="profile-summary-card">
            <button type="button" className="customer-profile-photo-button" onClick={() => photoInput.current?.click()} aria-label="Upload a profile photo">
              {profilePhoto ? <img src={profilePhoto} alt="Your profile" /> : <span>{profile.user.fullName.trim().charAt(0).toUpperCase() || 'U'}</span>}
              <span className="photo-upload-indicator"><Camera className="icon" /></span>
            </button>
            <input ref={photoInput} type="file" accept="image/*" className="visually-hidden" onChange={(event) => {
              uploadProfilePhoto(event.target.files?.[0])
              event.currentTarget.value = ''
            }} />
            <div>
              <h2>{profile.user.fullName}</h2>
              <p>Customer account · Profile photo stays on this device</p>
            </div>
            <button
              type="button"
              className="quiet-action"
              onClick={() => {
                if (editingProfile) setProfileForm({ fullName: profile.user.fullName, phone: profile.user.phone ?? '' })
                setEditingProfile((current) => !current)
                setError('')
                setMessage('')
              }}
            >
              {editingProfile ? 'Cancel' : 'Edit profile'}
            </button>
          </section>
          <div className="profile-shortcuts">
            <button type="button" onClick={() => navigate('/orders')}><ShoppingBag className="icon" /><span><strong>My orders</strong><small>Track deliveries and order again</small></span><ArrowUpRight className="icon" /></button>
            <button type="button" onClick={() => navigate('/favorites')}><Heart className="icon" /><span><strong>Saved medicines</strong><small>Your favorite pharmacy products</small></span><ArrowUpRight className="icon" /></button>
          </div>
          {editingProfile ? (
            <form className="profile-edit-card" onSubmit={saveProfile}>
              <div className="profile-edit-heading">
                <span className="profile-edit-icon"><User className="icon" /></span>
                <div><h2>Your details</h2><p>Update the name and phone number used for your account.</p></div>
              </div>
              <div className="profile-input-grid">
                <label>Full name<input required minLength={2} value={profileForm.fullName} onChange={(event) => setProfileForm({ ...profileForm, fullName: event.target.value })} /></label>
                <label>Phone number<input type="tel" autoComplete="tel" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} /></label>
              </div>
              <button type="submit" className="accept-action" disabled={busy || locating}>{busy ? 'Saving…' : 'Save profile'}</button>
            </form>
          ) : <div className="profile-contact-card">
            <div><User className="icon" /><span>{profile.user.fullName}</span></div>
            <div><Mail className="icon" /><span>{profile.user.email}</span></div>
            {profile.user.phone && <div><Phone className="icon" /><span>{profile.user.phone}</span></div>}
          </div>}
          <section className="profile-edit-card">
            <div className="profile-edit-heading">
              <span className="location-editor-icon"><MapPin className="icon" /></span>
              <div><h2>Saved addresses</h2><p>Manage delivery addresses or GPS coordinates. GPS is requested only when you choose Use GPS.</p></div>
              <button type="button" className="quiet-action" onClick={beginNewAddress}>Add address</button>
            </div>
            {profile.addresses.length ? (
              <div className="profile-address-list">
                {profile.addresses.map((address) => (
                  <article className="profile-contact-card" key={address.id}>
                    <div><MapPin className="icon" /><span><strong>{address.label}</strong>{address.isDefault && <small> · Default</small>}</span></div>
                    <div><span>{formatCustomerAddress(address) || 'No address details saved'}</span></div>
                    {address.contactPhone && <div><Phone className="icon" /><span>{address.contactPhone}</span></div>}
                    <div className="profile-address-actions">
                      {!address.isDefault && <button type="button" className="text-action" onClick={() => void makeDefault(address)}>Make default</button>}
                      <button type="button" className="text-action" onClick={() => beginEditAddress(address)}>Edit</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="profile-empty-location">No saved addresses yet. Add a manual address or GPS coordinates.</p>}
            {addressEditorOpen && (
              <form className="location-editor" onSubmit={saveAddress}>
                <div className="location-editor-heading">
                  <span className="location-editor-icon"><Pencil className="icon" /></span>
                  <div><h3>{editingAddressId === null ? 'Add an address' : 'Edit address'}</h3><p>Enter a manual location, use GPS, or save both.</p></div>
                </div>
                <div className="profile-input-grid">
                  <label>Label<input required maxLength={60} placeholder="Home, work..." value={addressForm.label} onChange={(event) => setAddressForm({ ...addressForm, label: event.target.value })} /></label>
                  <label>Contact phone<input type="tel" autoComplete="tel" value={addressForm.contactPhone} onChange={(event) => setAddressForm({ ...addressForm, contactPhone: event.target.value })} /></label>
                  <label className="profile-field-wide">Street address<input autoComplete="street-address" placeholder="House number and street (optional when using GPS)" value={addressForm.address} onChange={(event) => setAddressForm({ ...addressForm, address: event.target.value })} /></label>
                  <label>City<input autoComplete="address-level2" value={addressForm.city} onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })} /></label>
                  <label>State<input autoComplete="address-level1" value={addressForm.state} onChange={(event) => setAddressForm({ ...addressForm, state: event.target.value })} /></label>
                  <label>Postal code<input autoComplete="postal-code" value={addressForm.postalCode} onChange={(event) => setAddressForm({ ...addressForm, postalCode: event.target.value })} /></label>
                  <label>Latitude<input type="number" step="any" min="-90" max="90" value={addressForm.latitude ?? ''} onChange={(event) => setAddressForm({ ...addressForm, latitude: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                  <label>Longitude<input type="number" step="any" min="-180" max="180" value={addressForm.longitude ?? ''} onChange={(event) => setAddressForm({ ...addressForm, longitude: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                </div>
                <button type="button" className="location-choice" onClick={captureCurrentLocation} disabled={locating}>
                  <MapPin className="icon" /><span><strong>{locating ? 'Requesting location…' : 'Use GPS'}</strong><small>Only this button asks your device for location permission.</small></span>
                </button>
                {addressForm.latitude !== null && addressForm.longitude !== null && <p className="profile-empty-location">Coordinates: {addressForm.latitude.toFixed(5)}, {addressForm.longitude.toFixed(5)}. No reverse lookup is used.</p>}
                <label className="profile-default-address"><input type="checkbox" checked={addressForm.isDefault} onChange={(event) => setAddressForm({ ...addressForm, isDefault: event.target.checked })} /> Set as default delivery address</label>
                <div className="profile-address-actions">
                  <button type="submit" className="accept-action" disabled={busy || locating}>{busy ? 'Saving…' : 'Save address'}</button>
                  <button type="button" className="text-action" onClick={() => { setAddressEditorOpen(false); setError('') }}>Cancel</button>
                </div>
              </form>
            )}
          </section>
          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="owner-form-error" role="alert">{error}</p>}
          <button type="button" className="profile-sign-out-button" onClick={onSignOut}><LogOut className="icon" /> Sign out</button>
        </>
      ) : (
        <div className="empty-state-card compact-empty">
          <p>{profileLoading ? 'Loading your profile…' : 'Your profile could not be loaded.'}</p>
          {error && <p className="owner-form-error" role="alert">{error}</p>}
        </div>
      )}
      <CustomerBottomNav />
    </motion.main>
  )
}

function ProductDetailPage({
  products,
  session,
  onAddToCart,
  onToggleFavorite,
  favoriteIds,
  favoritesError,
  onReviewsChanged,
  reviewsOnly = false,
}: {
  products: Product[]
  session: AccountSession
  onAddToCart: (product: Product, quantity: number) => boolean
  onToggleFavorite: (productId: number) => Promise<boolean>
  favoriteIds: number[]
  favoritesError: string
  onReviewsChanged: () => void
  reviewsOnly?: boolean
}) {
  const navigate = useNavigate()
  const { id } = useParams()
  const productId = Number(id)
  const [product, setProduct] = useState<Product | null>(() => products.find((item) => item.id === productId) ?? null)
  const [recommendations, setRecommendations] = useState<Product[]>([])
  const [productLoading, setProductLoading] = useState(true)
  const [productError, setProductError] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [reviews, setReviews] = useState<Array<{ id: number; rating: number; comment: string; createdAt: string; customerName: string }>>([])
  const [averageRating, setAverageRating] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [canReview, setCanReview] = useState(false)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewSaving, setReviewSaving] = useState(false)
  const [cartActionError, setCartActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadProduct = async () => {
      if (!Number.isSafeInteger(productId) || productId < 1) {
        setProduct(null)
        setProductLoading(false)
        return
      }
      setProductLoading(true)
      setProductError('')
      try {
        const response = await fetch(apiUrl(`/api/medicines/${productId}`))
        const result = await response.json() as {
          medicine?: Product & {
            availableStock: number
            availabilityReason: string | null
            warnings: string[]
            manufacturer: string | null
            batchNumber: string | null
            expiryDate: string | null
          }
          recommendations?: Product[]
          error?: string
        }
        if (!response.ok || !result.medicine) throw new Error(result.error || 'Could not load this medicine.')
        const medicine = result.medicine
        if (cancelled) return
        setProduct({ ...medicine, stock: medicine.availableStock, image: medicine.imageUrl || '/pharma-plus-icon.png' } as Product)
        setRecommendations(result.recommendations ?? [])
      } catch (requestError) {
        if (!cancelled) {
          setProductError(requestError instanceof Error ? requestError.message : 'Could not load this medicine.')
          setProduct(null)
        }
      } finally {
        if (!cancelled) setProductLoading(false)
      }
    }
    // Load the authoritative scoped medicine record, not only the browse-card summary.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadProduct()
    return () => { cancelled = true }
  }, [productId])

  useEffect(() => {
    let cancelled = false
    const loadReviews = async () => {
      if (!Number.isSafeInteger(productId) || productId < 1) return
      try {
        const [reviewsResponse, ordersResponse] = await Promise.all([
          fetch(apiUrl(`/api/catalog/medicines/${productId}/reviews`)),
          authenticatedApiFetch('/api/customer/orders', session.token),
        ])
        const [reviewResult, ordersResult] = await Promise.all([reviewsResponse.json(), ordersResponse.json()])
        if (!reviewsResponse.ok) throw new Error(reviewResult.error || 'Could not load product reviews.')
        if (!ordersResponse.ok) throw new Error(ordersResult.error || 'Could not check your delivered orders.')
        if (cancelled) return
        setReviews(reviewResult.reviews)
        setAverageRating(reviewResult.rating)
        setReviewCount(reviewResult.reviewCount)
        setCanReview((ordersResult as CustomerOrder[]).some((order) =>
          order.status === 'delivered' && order.items.some((item) => item.medicineId === productId),
        ))
        setReviewError('')
      } catch (requestError) {
        if (!cancelled) setReviewError(requestError instanceof Error ? requestError.message : 'Could not load product reviews.')
      }
    }
    // Load persisted customer reviews and verify eligibility from delivered orders.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadReviews()
    return () => { cancelled = true }
  }, [productId, session.token])

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!product) return
    setReviewSaving(true)
    setReviewError('')
    setReviewMessage('')
    try {
      const response = await authenticatedApiFetch(`/api/customer/medicines/${product.id}/reviews`, session.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save your review.')
      setReviewComment('')
      setReviewMessage('Thanks — your verified-purchase review was saved.')
      onReviewsChanged()
      const reviewsResponse = await fetch(apiUrl(`/api/catalog/medicines/${product.id}/reviews`))
      const reviewsResult = await reviewsResponse.json()
      if (!reviewsResponse.ok) throw new Error(reviewsResult.error || 'Your review was saved, but the list could not be refreshed.')
      setReviews(reviewsResult.reviews)
      setAverageRating(reviewsResult.rating)
      setReviewCount(reviewsResult.reviewCount)
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Could not save your review.')
    } finally {
      setReviewSaving(false)
    }
  }

  const addProductToCart = (buyNow = false) => {
    if (!product) return
    setCartActionError('')
    if (!onAddToCart(product, quantity)) {
      setCartActionError('Could not add this item. Check available stock and make sure your cart is from the same pharmacy.')
      return
    }
    navigate(buyNow ? '/checkout' : '/cart')
  }

  if (productLoading) {
    return <main className="screen"><div className="empty-state-card compact-empty">Loading medicine details…</div></main>
  }
  if (!product) {
    return (
      <div className="empty-state-card">
        <h2>Medicine unavailable</h2>
        <p>{productError || 'This medicine may no longer be available.'}</p>
        <button className="accept-action" onClick={() => navigate('/')}>Back to medicines</button>
      </div>
    )
  }
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className={reviewsOnly ? 'screen details-screen reviews-only-screen' : 'screen details-screen'}>
      <header className="topbar detail-topbar">
        <BackButton fallback="/" />
        {reviewsOnly ? <h2>Medicine Reviews</h2> : null}
        <button type="button" className={favoriteIds.includes(product.id) ? 'icon-button light selected' : 'icon-button light'} aria-label={favoriteIds.includes(product.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void onToggleFavorite(product.id)}>
          <Heart className="icon" />
        </button>
      </header>

      <div className="image-stage">
        <img src={product.image} alt={product.name} />
      </div>

      <motion.div layout className="detail-sheet">
        <div className="detail-header-row">
          <div>
            <h2>{product.name}</h2>
            <small>{product.pack}</small>
            <p className="detail-pharmacy-name"><MapPin className="icon" /> {product.pharmacyName}</p>
            <p>{[product.brandName, product.genericName, product.strength, product.dosageForm].filter(Boolean).join(' · ') || 'Product identity details not recorded'}</p>
            {product.manufacturer && <p>Manufacturer: {product.manufacturer}</p>}
            {product.batchNumber && <p>Batch: {product.batchNumber}</p>}
            {product.expiryDate && <p>Expiry: {product.expiryDate.slice(0, 10)}</p>}
          </div>
          <div className="rating-badge">
            <Star className="star-icon" />
            {reviewCount ? averageRating.toFixed(1) : 'New'}{reviewCount > 0 && <small>{reviewCount}</small>}
          </div>
        </div>

        <div className="price-row">
          <strong>₹{product.price.toLocaleString('en-IN')}</strong>
          <div className="quantity-control">
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={quantity <= 1 || !product.available}>
              <Minus className="icon" />
            </button>
            <span>{quantity}</span>
            <button type="button" onClick={() => setQuantity((value) => Math.min(product.stock, value + 1))} aria-label="Increase quantity" disabled={!product.available || quantity >= product.stock}>
              <Plus className="icon" />
            </button>
          </div>
        </div>

        <div className="tablet-strip-wrap">
          <div className="tablet-strip-header">
            <span>Quantity</span>
            <span>{quantity} pack(s)</span>
          </div>
          <p>{product.packQuantity && product.packUnit
            ? `${quantity * product.packQuantity} ${product.packUnit} total`
            : 'Pack-to-unit conversion is unavailable until pack dimensions are recorded.'}</p>
        </div>

        {!product.available && (
          <p className="owner-form-error" role="status">
            {product.availabilityReason === 'expired' || product.availabilityReason === 'expired_batches'
              ? 'Unavailable: expired medicine stock is excluded from sellable inventory.'
              : product.availabilityReason === 'inactive'
                ? 'Unavailable: this pharmacy listing is inactive.'
                : 'Currently out of stock.'}
          </p>
        )}
        {product.warnings?.map((warning) => <p className="compare-location-notice" key={warning} role="note">{warning}</p>)}
        <div className="description-block">
          <div className="section-header compact">
            <h3>Description</h3>
          </div>
          <p>{product.description || 'Product information has not been added yet.'}</p>
        </div>
        {!reviewsOnly && (
          <>
            <div className="product-detail-actions">
              <button type="button" className="primary-cta secondary-cta" disabled={!product.available || product.stock < 1} onClick={() => addProductToCart()}>
                <ShoppingBag className="icon" /> Add to cart
              </button>
              <button type="button" className="primary-cta" disabled={!product.available || product.stock < 1} onClick={() => addProductToCart(true)}>
                Buy now <ArrowUpRight className="icon" />
              </button>
              <button type="button" className="primary-cta secondary-cta product-detail-compare" disabled={!product.available || product.stock < 1} onClick={() => navigate(`/compare/${product.id}`, { state: { quantity } })}>
                Compare prices & choose pharmacy
              </button>
            </div>
            {cartActionError && <p className="owner-form-error" role="alert">{cartActionError}</p>}
          </>
        )}
        {favoritesError && <p className="owner-form-error" role="alert">{favoritesError}</p>}
        <section className="product-review-section">
          <div className="product-review-product"><img src={product.image} alt="" /><div><strong>{product.name}</strong><span>{product.pharmacyName}</span></div><span className={canReview ? 'order-status-pill delivered' : 'order-status-pill pending'}>{canReview ? 'Delivered' : 'Not delivered'}</span></div>
          <header className="product-review-heading"><div><h3>Customer reviews</h3><p>{reviewCount ? `${averageRating.toFixed(1)} average · ${reviewCount} verified reviews` : 'Be the first to share a verified-purchase review.'}</p></div><button type="button" onClick={() => navigate(`/product/${product.id}/reviews`)}>See all</button></header>
          {reviewError && <p className="owner-form-error" role="alert">{reviewError}</p>}
          {reviewMessage && <p className="success-message" role="status">{reviewMessage}</p>}
          {canReview ? (
            <form className="product-review-form" onSubmit={submitReview}>
              <span>Rate your delivered medicine</span>
              <div className="review-star-picker">{[1, 2, 3, 4, 5].map((rating) => (
                <button type="button" key={rating} aria-label={`Rate ${rating} out of 5 stars`} aria-pressed={reviewRating === rating} data-filled={reviewRating >= rating} onClick={() => setReviewRating(rating)}><Star className="star-icon" /></button>
              ))}</div>
              <textarea rows={3} maxLength={500} placeholder="Share a helpful comment (optional)" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} />
              <button type="submit" className="accept-action" disabled={reviewSaving}>{reviewSaving ? 'Saving…' : 'Post review'}</button>
            </form>
          ) : <p className="review-eligibility-note">Reviews are available after this medicine is delivered in one of your orders.</p>}
          <div className="product-review-list">{reviews.map((review) => (
            <article className="product-review-card" key={review.id}>
              <div><strong>{review.customerName}</strong><span>{new Date(review.createdAt).toLocaleDateString()}</span></div>
              <p>{Array.from({ length: review.rating }, () => '★').join('')}</p>
              {review.comment && <small>{review.comment}</small>}
            </article>
          ))}</div>
        </section>
        <section className="recommended-products">
          <h3>More in {product.category} at {product.pharmacyName}</h3>
          {recommendations.length ? (
            <div className="recommended-product-row">{recommendations.map((item) => (
              <button type="button" className="recommended-product-card" key={item.id} onClick={() => navigate(`/product/${item.id}`)}>
                <img src={item.imageUrl || '/pharma-plus-icon.png'} alt="" />
                <span><strong>{item.name}</strong><small>{item.pack} · ₹{item.price.toLocaleString('en-IN')}</small></span>
              </button>
            ))}</div>
          ) : <p>No other in-stock products in this category at this pharmacy.</p>}
        </section>
      </motion.div>
    </motion.div>
  )
}

function CheckoutPage({
  cart,
  cartError,
  session,
  paymentMethod,
  setPaymentMethod,
  onClearCart,
}: {
  cart: CartItem[]
  cartError: string
  session: AccountSession
  paymentMethod: string
  setPaymentMethod: (method: string) => void
  onClearCart: () => void
}) {
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null)
  const [fulfillmentMethod, setFulfillmentMethod] = useState<'delivery' | 'pickup'>('delivery')
  const [discountCode, setDiscountCode] = useState('')
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [quoteRequestKey, setQuoteRequestKey] = useState('')
  const [addressLoading, setAddressLoading] = useState(true)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(cartError)
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([])
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<number | null>(null)
  const [prescriptionFile, setPrescriptionFile] = useState<File | null>(null)
  const [prescriptionError, setPrescriptionError] = useState('')
  const [prescriptionMessage, setPrescriptionMessage] = useState('')
  const [uploadingPrescription, setUploadingPrescription] = useState(false)
  const prescriptionFileInput = useRef<HTMLInputElement>(null)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const selectedAddress = addresses.find((address) => address.id === selectedAddressId) ?? null
  const restrictedItems = cart.filter((item) => item.prescriptionRequired)
  const requiredMedicineIds = restrictedItems.map((item) => item.id)
  const eligiblePrescriptions = prescriptions.filter((prescription) =>
    prescription.status === 'approved' &&
    prescription.documentAvailable &&
    prescription.validUntil !== null &&
    prescription.validUntil >= today &&
    restrictedItems.every((item) => {
      const approval = prescription.items.find((entry) => entry.medicineId === item.id)
      return approval !== undefined && approval.remainingQuantity >= item.quantity
    }),
  )
  const selectedPrescription = eligiblePrescriptions.find((entry) => entry.id === selectedPrescriptionId) ?? null
  const checkoutPayload = () => ({
    items: cart.map((item) => ({
      medicineId: item.id,
      pharmacy_id: item.pharmacy_id,
      quantity: item.quantity,
      ...(item.prescriptionRequired && selectedPrescription ? { prescriptionId: selectedPrescription.id } : {}),
    })),
    paymentMethod,
    fulfillmentMethod,
    ...(fulfillmentMethod === 'delivery' ? { addressId: selectedAddressId } : {}),
    discountCode: discountCode.trim() || null,
  })
  const currentQuoteRequestKey = JSON.stringify(checkoutPayload())
  const activeQuote = quote && quoteRequestKey === currentQuoteRequestKey ? quote : null
  const loadPrescriptions = useCallback(async () => {
    const response = await authenticatedApiFetch('/api/me/prescriptions', session.token)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load your prescription status.')
    setPrescriptions(result as PrescriptionRecord[])
  }, [session.token])

  useEffect(() => {
    let cancelled = false
    const loadAddresses = async () => {
      try {
        const response = await authenticatedApiFetch('/api/me/addresses', session.token)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load your saved addresses.')
        const savedAddresses = result.addresses as CustomerAddress[]
        if (!cancelled) {
          setAddresses(savedAddresses)
          setSelectedAddressId((current) => current ?? savedAddresses.find((address) => address.isDefault)?.id ?? savedAddresses[0]?.id ?? null)
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load your saved addresses.')
      } finally {
        if (!cancelled) setAddressLoading(false)
      }
    }
    // oxlint-disable-next-line react/set-state-in-effect
    void loadAddresses()
    return () => { cancelled = true }
  }, [session.token])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await loadPrescriptions()
      } catch (requestError) {
        if (!cancelled) setPrescriptionError(requestError instanceof Error ? requestError.message : 'Could not load your prescription status.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [loadPrescriptions])

  const uploadPrescription = async () => {
    if (!prescriptionFile) {
      setPrescriptionError('Choose a PDF, JPEG, or PNG prescription first.')
      return
    }
    if (prescriptionFile.size > 5 * 1024 * 1024) {
      setPrescriptionError('Prescription files must be 5 MB or smaller.')
      return
    }
    setUploadingPrescription(true)
    setPrescriptionError('')
    setPrescriptionMessage('')
    try {
      const formData = new FormData()
      formData.append('file', prescriptionFile)
      formData.append('items', JSON.stringify(restrictedItems.map((item) => ({
        medicineId: item.id,
        quantity: item.quantity,
      }))))
      const response = await authenticatedApiFetch('/api/me/prescriptions', session.token, {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not upload your prescription.')
      setPrescriptionMessage(`Document uploaded for pharmacist review (reference #${result.id}). Restricted items stay blocked until approved.`)
      setPrescriptionFile(null)
      if (prescriptionFileInput.current) prescriptionFileInput.current.value = ''
      try {
        await loadPrescriptions()
      } catch (refreshError) {
        setPrescriptionError(refreshError instanceof Error ? `Upload succeeded, but status could not refresh: ${refreshError.message}` : 'Upload succeeded, but prescription status could not refresh.')
      }
    } catch (requestError) {
      setPrescriptionError(requestError instanceof Error ? requestError.message : 'Could not upload your prescription.')
    } finally {
      setUploadingPrescription(false)
    }
  }

  const requestQuote = async () => {
    setQuoteLoading(true)
    setError('')
    setQuote(null)
    setQuoteRequestKey('')
    const payload = checkoutPayload()
    const requestKey = JSON.stringify(payload)
    try {
      const response = await authenticatedApiFetch('/api/checkout/quote', session.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) {
        const corrections = Array.isArray(result.corrections)
          ? result.corrections.map((item: { name?: string; requestedQuantity: number; availableQuantity: number }) =>
            `${item.name || 'Medicine'}: requested ${item.requestedQuantity}, available ${item.availableQuantity}`).join('; ')
          : ''
        throw new Error([result.error || 'Could not confirm current prices and stock.', corrections].filter(Boolean).join(' '))
      }
      setQuote(result as CheckoutQuote)
      setQuoteRequestKey(requestKey)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not confirm current prices and stock.')
    } finally {
      setQuoteLoading(false)
    }
  }

  const placeOrder = async () => {
    setSaving(true)
    setError('')
    try {
      if (!activeQuote) throw new Error('Request a confirmed quote before placing your order.')
      const response = await authenticatedApiFetch('/api/orders', session.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...checkoutPayload(),
          quoteId: activeQuote.quoteId,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (result.quote) {
          setQuote(result.quote as CheckoutQuote)
          setQuoteRequestKey(currentQuoteRequestKey)
        } else {
          setQuote(null)
          setQuoteRequestKey('')
        }
        throw new Error(result.error || 'Could not place your order.')
      }
      const order = result as CustomerOrder
      localStorage.setItem(`pharma-plus-delivery-otp-${session.user.id}-${order.id}`, order.deliveryOtp ?? '')
      onClearCart()
      navigate(`/orders/${order.id}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not place your order.')
    } finally {
      setSaving(false)
    }
  }

  if (!cart.length) {
    return (
      <div className="empty-state-card checkout-empty">
        <BackButton fallback="/" />
        <ShoppingBag className="empty-state-icon" />
        <h2>Your cart is empty</h2>
        <p>Choose medicines from one pharmacy to continue.</p>
        <button type="button" className="accept-action" onClick={() => navigate('/')}>Browse medicines</button>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen checkout-screen">
      <header className="topbar checkout-topbar">
        <BackButton fallback="/" />
        <h2>Checkout</h2>
        <span className="checkout-step-label">SECURE CHECKOUT</span>
      </header>

      <div className="cart-summary-card">
        <div className="checkout-section-heading"><span className="checkout-section-icon"><User className="icon" /></span><div><h3>Delivery contact</h3><p>Confirm the details for this order.</p></div></div>
        <div className="checkout-contact-card">
          <div><span className="meta-label">Name</span><strong>{session.user.fullName}</strong></div>
          <div><span className="meta-label">Phone</span><strong>{(fulfillmentMethod === 'delivery' ? selectedAddress?.contactPhone : null) || session.user.phone || 'Add a phone number in your profile'}</strong></div>
        </div>
        <div className="checkout-section-heading"><span className="checkout-section-icon"><PackageCheck className="icon" /></span><div><h3>Fulfillment</h3><p>Choose delivery or collect your order from the pharmacy.</p></div></div>
        <div className="payment-stack" role="group" aria-label="Fulfillment method">
          <button type="button" className={fulfillmentMethod === 'delivery' ? 'payment-option selected' : 'payment-option'} onClick={() => { setQuote(null); setFulfillmentMethod('delivery') }} aria-pressed={fulfillmentMethod === 'delivery'}>
            <span>Delivery</span>{fulfillmentMethod === 'delivery' ? <Check className="icon" /> : <span className="dot" />}
          </button>
          <button type="button" className={fulfillmentMethod === 'pickup' ? 'payment-option selected' : 'payment-option'} onClick={() => { setQuote(null); setFulfillmentMethod('pickup') }} aria-pressed={fulfillmentMethod === 'pickup'}>
            <span>Pharmacy pickup</span>{fulfillmentMethod === 'pickup' ? <Check className="icon" /> : <span className="dot" />}
          </button>
        </div>
        {fulfillmentMethod === 'delivery' ? (
          <>
            <div className="checkout-section-heading"><span className="checkout-section-icon"><MapPin className="icon" /></span><div><h3>Delivery address</h3><p>Select one of your saved destinations.</p></div></div>
            {addressLoading ? <p className="profile-empty-location">Loading saved addresses…</p> : addresses.length ? (
              <div className="checkout-address-options">
                {addresses.map((address) => (
                  <label className={selectedAddressId === address.id ? 'checkout-address-option selected' : 'checkout-address-option'} key={address.id}>
                    <input type="radio" name="delivery-address" value={address.id} checked={selectedAddressId === address.id} onChange={() => { setQuote(null); setSelectedAddressId(address.id) }} />
                    <span><strong>{address.label}{address.isDefault ? ' · Default' : ''}</strong><small>{formatCustomerAddress(address)}</small>{address.contactPhone && <small>Contact: {address.contactPhone}</small>}</span>
                  </label>
                ))}
              </div>
            ) : <p className="profile-empty-location">No saved delivery address. Add one in your profile before ordering.</p>}
            <button type="button" className="text-action" onClick={() => navigate('/profile')}>Manage saved addresses</button>
          </>
        ) : <p className="profile-empty-location">No delivery address is needed for pickup. The quote will verify current pickup availability.</p>}
        <label className="checkout-discount-field">Discount code (optional)
          <input value={discountCode} maxLength={60} autoComplete="off" placeholder="Enter a promo code" onChange={(event) => { setQuote(null); setDiscountCode(event.target.value) }} />
        </label>
        {restrictedItems.length > 0 && (
          <section className="checkout-prescription-card" aria-label="Prescription approval">
            <div className="checkout-section-heading"><span className="checkout-section-icon"><ClipboardList className="icon" /></span><div><h3>Prescription approval required</h3><p>Restricted medicines cannot be quoted or ordered until an authorized pharmacist approves a valid prescription.</p></div></div>
            <div className="prescription-required-items">
              {restrictedItems.map((item) => <p key={item.id}><strong>{item.name}</strong> · {item.quantity} pack(s)</p>)}
            </div>
            {eligiblePrescriptions.length ? (
              <label className="checkout-discount-field">Approved prescription
                <select value={selectedPrescription?.id ?? ''} onChange={(event) => {
                  setQuote(null)
                  setSelectedPrescriptionId(event.target.value ? Number(event.target.value) : null)
                }}>
                  <option value="">Choose an approved document</option>
                  {eligiblePrescriptions.map((prescription) => (
                    <option key={prescription.id} value={prescription.id}>
                      Prescription #{prescription.id} · valid through {prescription.validUntil}
                    </option>
                  ))}
                </select>
              </label>
            ) : <p className="profile-empty-location">No current approved prescription covers every restricted item and requested quantity.</p>}
            <label className="prescription-file-field">Upload prescription (PDF, JPEG, or PNG · up to 5 MB)
              <input
                ref={prescriptionFileInput}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => {
                  setPrescriptionFile(event.target.files?.[0] ?? null)
                  setPrescriptionError('')
                  setPrescriptionMessage('')
                }}
              />
            </label>
            <p className="prescription-privacy-note">Documents are malware-scanned, encrypted, and stored outside public assets. They are never exposed through a public URL. Uploads fail closed if secure storage or malware screening is unavailable.</p>
            <button type="button" className="accept-action" disabled={!prescriptionFile || uploadingPrescription} onClick={() => void uploadPrescription()}>
              {uploadingPrescription ? 'Scanning and securely uploading…' : 'Upload for pharmacist review'}
            </button>
            {prescriptionMessage && <p className="verification-success" role="status">{prescriptionMessage}</p>}
            {prescriptionError && <p className="owner-form-error" role="alert">{prescriptionError}</p>}
            {prescriptions.filter((prescription) => prescription.items.some((item) => requiredMedicineIds.includes(item.medicineId))).map((prescription) => (
              <article className="prescription-history-card" key={prescription.id}>
                <strong>Prescription #{prescription.id} · {prescription.status.replace('_', ' ')}</strong>
                <span>Submitted {new Date(prescription.submittedAt).toLocaleDateString()}</span>
                {prescription.reviewReason && <small>Pharmacist note: {prescription.reviewReason}</small>}
                {!prescription.documentAvailable && <small>Document deleted under the retention policy.</small>}
              </article>
            ))}
          </section>
        )}
        <div className="checkout-section-heading"><span className="checkout-section-icon"><PackageCheck className="icon" /></span><div><h3>Order summary</h3><p>{cart.reduce((sum, item) => sum + item.quantity, 0)} pack(s)</p></div></div>
        {activeQuote ? (
          <section className="checkout-quote" aria-label="Confirmed price quote">
            <p className="checkout-quote-title">Current confirmed price · {activeQuote.pharmacyName}</p>
            {activeQuote.items.map((item) => (
              <div className="checkout-quote-line" key={item.medicineId}>
                <span>
                  <strong>{item.name} × {item.quantity} pack(s)</strong>
                  <small>₹{item.unitPrice.toLocaleString('en-IN')} per pack · {item.availableQuantity} pack(s) currently available</small>
                  {item.baseUnitQuantity !== null && <small>{item.baseUnitQuantity} {item.packUnit} total ({item.packQuantity} per pack)</small>}
                  {item.prescriptionRequired && <small>Approved prescription #{item.prescriptionId} · valid through {item.prescriptionValidUntil}</small>}
                  {item.discountAmount > 0 && <small>Discount −₹{item.discountAmount.toLocaleString('en-IN')} · tax {item.taxRate}%</small>}
                </span>
                <strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong>
              </div>
            ))}
            <div className="summary-row"><span>Subtotal</span><strong>₹{activeQuote.subtotal.toLocaleString('en-IN')}</strong></div>
            {activeQuote.discountAmount > 0 && <div className="summary-row"><span>Discount{activeQuote.discountCode ? ` (${activeQuote.discountCode})` : ''}</span><strong>−₹{activeQuote.discountAmount.toLocaleString('en-IN')}</strong></div>}
            <div className="summary-row"><span>Tax (pharmacy GST)</span><strong>₹{activeQuote.taxAmount.toLocaleString('en-IN')}</strong></div>
            <div className="summary-row"><span>{activeQuote.fulfillmentMethod === 'pickup' ? 'Pickup fee' : 'Delivery fee'}</span><strong>₹{activeQuote.deliveryFee.toLocaleString('en-IN')}</strong></div>
            <div className="summary-row total"><span>Confirmed total</span><strong>₹{activeQuote.total.toLocaleString('en-IN')}</strong></div>
            <p className="checkout-quote-expiry">Quote expires {new Date(activeQuote.expiresAt).toLocaleTimeString()}.</p>
          </section>
        ) : (
          <p className="checkout-quote-prompt">Cart prices are estimates. Request a live quote to confirm current prices, batch-backed stock, tax, discounts, and fulfillment fees.</p>
        )}
        <div className="checkout-section-heading"><span className="checkout-section-icon"><ShoppingBag className="icon" /></span><div><h3>Payment method</h3><p>Choose how you would like to pay.</p></div></div>
        <div className="payment-stack">
          {['Cash on Delivery', 'UPI Payment'].map((option) => (
            <button
              key={option}
              className={paymentMethod === option ? 'payment-option selected' : 'payment-option'}
              onClick={() => { setQuote(null); setPaymentMethod(option) }}
            >
              <span>{option}</span>
              {paymentMethod === option ? <Check className="icon" /> : <span className="dot" />}
            </button>
          ))}
        </div>
        <p className="checkout-quote-prompt">UPI remains pending until a verified payment gateway confirms payment. Choosing UPI here does not mark the order paid.</p>
        {error && <p className="owner-form-error" role="alert">{error}</p>}
        <button
          type="button"
          className="primary-cta dark"
          disabled={saving || quoteLoading || addressLoading ||
            (fulfillmentMethod === 'delivery' && !selectedAddress) ||
            (restrictedItems.length > 0 && !selectedPrescription)}
          onClick={() => void (activeQuote ? placeOrder() : requestQuote())}
        >
          {quoteLoading ? 'Checking current prices and stock…' : saving ? 'Placing order…' : activeQuote ? 'Confirm quote and place order' : 'Get confirmed total'}
        </button>
      </div>
    </motion.div>
  )
}

function WelcomePage() {
  const navigate = useNavigate()

  return (
    <main className="welcome-page">
      <div className="welcome-brand">
        <div className="brand-mark">P+</div>
        <h1>Pharma <span>Plus</span></h1>
        <p>Your local pharmacy marketplace</p>
      </div>
      <div className="welcome-illustration" aria-hidden="true">
        <span className="welcome-leaf leaf-one" />
        <span className="welcome-leaf leaf-two" />
        <div className="welcome-bag"><Plus className="icon" /><small>PHARMACY</small></div>
        <span className="welcome-bottle"><Pill className="icon" /></span>
        <span className="welcome-tablet"><Pill className="icon" /></span>
      </div>
      <section className="welcome-copy">
        <h2>Medicines from<br />trusted local pharmacies</h2>
        <p>Find genuine medicines and care close to home.</p>
      </section>
      <div className="welcome-features">
        <div><Truck className="icon" /><span>Home<br />delivery</span></div>
        <div><PackageCheck className="icon" /><span>Trusted<br />pharmacies</span></div>
        <div><CircleCheck className="icon" /><span>Genuine<br />medicines</span></div>
        <div><Star className="icon" /><span>Ratings &<br />reviews</span></div>
      </div>
      <div className="welcome-actions">
        <button type="button" className="welcome-sign-in" onClick={() => navigate('/auth?mode=signin')}>
          <LogIn className="icon" /> Sign in <ArrowUpRight className="icon" />
        </button>
        <button type="button" className="welcome-sign-up" onClick={() => navigate('/account-type')}>
          <User className="icon" /> Create new account <ArrowUpRight className="icon" />
        </button>
      </div>
    </main>
  )
}

function AccountTypeSelectionPage() {
  const navigate = useNavigate()
  const [role, setRole] = useState<AccountRole>('customer')

  return (
    <main className="account-type-page">
      <header className="account-type-header">
        <BackButton fallback="/welcome" />
        <div className="brand-mark">P+</div>
        <strong>Pharma <span>Plus</span></strong>
      </header>
      <section className="account-type-copy">
        <h1>Create your account</h1>
        <p>Join Pharma Plus and get medicines delivered from trusted local pharmacies.</p>
      </section>
      <div className="account-type-options" role="group" aria-label="Choose account type">
        <button type="button" className={role === 'customer' ? 'account-type-card selected' : 'account-type-card'} aria-pressed={role === 'customer'} onClick={() => setRole('customer')}>
          <span className="account-type-icon"><User className="icon" /></span>
          <span><strong>Customer account</strong><small>Browse medicines, order from pharmacies, track delivery, and rate medicines.</small></span>
          <CircleCheck className="icon account-type-check" />
        </button>
        <button type="button" className={role === 'pharmacy_owner' ? 'account-type-card selected owner' : 'account-type-card owner'} aria-pressed={role === 'pharmacy_owner'} onClick={() => setRole('pharmacy_owner')}>
          <span className="account-type-icon"><PackageCheck className="icon" /></span>
          <span><strong>Pharmacy owner account</strong><small>Manage your pharmacy, products, inventory, orders, and deliveries.</small></span>
          <CircleCheck className="icon account-type-check" />
        </button>
      </div>
      <button type="button" className="account-type-continue" onClick={() => navigate(`/auth?mode=signup&role=${role}`)}>
        Continue <ArrowUpRight className="icon" />
      </button>
      <p className="account-type-sign-in">Already have an account? <button type="button" onClick={() => navigate(`/auth?mode=signin&role=${role}`)}>Sign in</button></p>
      <div className="account-type-decoration" aria-hidden="true"><Pill className="icon" /><span /></div>
    </main>
  )
}

function AuthenticationPage({
  onAuthenticated,
  connectionError,
}: {
  onAuthenticated: (session: AccountSession) => void
  connectionError: string
}) {
  const [searchParams] = useSearchParams()
  const requestedRole = searchParams.get('role')
  const [role, setRole] = useState<AccountRole>(requestedRole === 'admin' ? 'admin' : requestedRole === 'pharmacy_owner' ? 'pharmacy_owner' : 'customer')
  const [isSignUp, setIsSignUp] = useState(searchParams.get('mode') === 'signup' && requestedRole !== 'admin')
  const [form, setForm] = useState({
    fullName: '',
    pharmacyName: '',
    phone: '',
    pharmacyAddress: '',
    city: '',
    state: '',
    postalCode: '',
    drugLicenseNumber: '',
    email: '',
    password: '',
    confirmation: '',
  })
  const [requestError, setRequestError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSignUp && form.password.length < 12) {
      setRequestError('Choose a password with at least 12 characters.')
      return
    }
    if (isSignUp && form.password !== form.confirmation) {
      setRequestError('Those passwords do not match.')
      return
    }
    setBusy(true)
    setRequestError('')
    try {
      const signupBody = role === 'customer'
        ? {
          role,
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }
        : {
          role,
          fullName: form.fullName,
          pharmacyName: form.pharmacyName,
          email: form.email,
          phone: form.phone,
          pharmacyAddress: form.pharmacyAddress,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          drugLicenseNumber: form.drugLicenseNumber,
          password: form.password,
        }
      const response = await fetch(apiUrl(isSignUp ? '/api/auth/signup' : '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSignUp
          ? signupBody
          : { email: form.email, password: form.password, role }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not sign in.')
      onAuthenticated(result as AccountSession)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  const setMode = (nextIsSignUp: boolean) => {
    setIsSignUp(nextIsSignUp)
    setRequestError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story-brand">
          <div className="brand-mark">P+</div>
          <div><strong>Pharma Plus</strong><span>Care, closer to home</span></div>
        </div>
        <div className="auth-story-copy">
          <span className="auth-kicker"><span /> YOUR HEALTH, MADE SIMPLE</span>
          <h1>Better care starts with the right connection.</h1>
          <p>One secure account for your health essentials, or your pharmacy business.</p>
        </div>
        <div className="auth-story-card">
          <span className="auth-story-icon"><Pill className="icon" /></span>
          <div>
            <strong>Local pharmacies. Personal care.</strong>
            <p>Customers and pharmacy teams get their own space, built around what they need.</p>
          </div>
          <span className="auth-story-sparkle">✦</span>
        </div>
        <div className="auth-story-footer">Secure accounts · Pharmacy-specific inventory</div>
      </section>

      <section className="auth-panel">
        <header className="auth-panel-header">
          <BackButton fallback="/welcome" />
          <span className="auth-mobile-brand"><span className="brand-mark">P+</span> Pharma Plus</span>
          <span className="auth-step-label">{isSignUp ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'}</span>
          <h2>{isSignUp ? 'Let’s get you started' : 'Sign in to continue'}</h2>
          <p>{isSignUp ? 'Choose how you’ll use Pharma Plus.' : 'Choose your account type to continue.'}</p>
        </header>

        <div className="auth-role-grid" aria-label="Account type">
          <button
            type="button"
            className={role === 'customer' ? 'auth-role-card selected' : 'auth-role-card'}
            aria-pressed={role === 'customer'}
            onClick={() => { setRole('customer'); setRequestError('') }}
          >
            <span className="auth-role-icon"><User className="icon" /></span>
            <span><strong>Customer</strong><small>Shop and manage your profile</small></span>
            <span className="auth-role-check">{role === 'customer' ? <Check className="icon" /> : null}</span>
          </button>
          <button
            type="button"
            className={role === 'pharmacy_owner' ? 'auth-role-card selected' : 'auth-role-card'}
            aria-pressed={role === 'pharmacy_owner'}
            onClick={() => { setRole('pharmacy_owner'); setRequestError('') }}
          >
            <span className="auth-role-icon"><PackageCheck className="icon" /></span>
            <span><strong>Pharmacy owner</strong><small>Manage your pharmacy</small></span>
            <span className="auth-role-check">{role === 'pharmacy_owner' ? <Check className="icon" /> : null}</span>
          </button>
          <button type="button" className={role === 'admin' ? 'auth-role-card selected' : 'auth-role-card'} aria-pressed={role === 'admin'} onClick={() => { setRole('admin'); setIsSignUp(false); setRequestError('') }}>
            <span className="auth-role-icon"><LayoutGrid className="icon" /></span>
            <span><strong>Administrator</strong><small>View platform operations</small></span>
            <span className="auth-role-check">{role === 'admin' ? <Check className="icon" /> : null}</span>
          </button>
        </div>

        <div className="auth-mode-switch" aria-label="Sign-in method">
          <button type="button" className={!isSignUp ? 'active' : ''} aria-pressed={!isSignUp} onClick={() => setMode(false)}>Sign in</button>
          {role !== 'admin' && <button type="button" className={isSignUp ? 'active' : ''} aria-pressed={isSignUp} onClick={() => setMode(true)}>Create account</button>}
        </div>

        {connectionError && <p className="auth-error" role="alert">{connectionError}</p>}
        {requestError && <p className="auth-error" role="alert">{requestError}</p>}
        <form className="auth-form" onSubmit={submit}>
          {isSignUp && (
            <div className="auth-fields two-column">
              <label>
                {role === 'customer' ? 'Your name' : 'Owner name'}
                <input autoComplete="name" required minLength={2} placeholder="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
              </label>
              {role === 'pharmacy_owner' && (
                <label>
                  Pharmacy name
                  <input required minLength={2} placeholder="Your pharmacy" value={form.pharmacyName} onChange={(event) => setForm({ ...form, pharmacyName: event.target.value })} />
                </label>
              )}
              <label>
                Phone number{role === 'customer' ? ' (optional)' : ''}
                <input type="tel" autoComplete="tel" required={role === 'pharmacy_owner'} placeholder="+91" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </label>
              {role === 'pharmacy_owner' && (
                <>
                  <label className="auth-field-wide">
                    Pharmacy address
                    <input autoComplete="street-address" placeholder="Street address" value={form.pharmacyAddress} onChange={(event) => setForm({ ...form, pharmacyAddress: event.target.value })} />
                  </label>
                  <label>
                    City
                    <input autoComplete="address-level2" placeholder="City" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                  </label>
                  <label>
                    State
                    <input autoComplete="address-level1" placeholder="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
                  </label>
                  <label>
                    Postal code
                    <input autoComplete="postal-code" placeholder="Postal code" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} />
                  </label>
                  <label>
                    Drug license number
                    <input placeholder="Optional" value={form.drugLicenseNumber} onChange={(event) => setForm({ ...form, drugLicenseNumber: event.target.value })} />
                  </label>
                </>
              )}
            </div>
          )}
          <div className="auth-fields">
            <label>
              Email address
              <input type="email" autoComplete="username" required placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label>
              Password
              <input type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={isSignUp ? 12 : undefined} required placeholder={isSignUp ? 'At least 12 characters' : 'Enter your password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </label>
            {isSignUp && (
              <label>
                Confirm password
                <input type="password" autoComplete="new-password" minLength={12} required placeholder="Enter your password again" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} />
              </label>
            )}
          </div>
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : isSignUp ? role === 'customer' ? 'Create customer account' : 'Create pharmacy account' : 'Sign in securely'}
            {!busy && <ArrowUpRight className="icon" />}
          </button>
        </form>
        <p className="auth-privacy-note">Your account opens only the {role === 'customer' ? 'customer' : role === 'admin' ? 'administrator' : 'pharmacy owner'} workspace.</p>
      </section>
    </main>
  )
}

type AdminOverview = { accounts: Record<string, number>; pharmacies: number; deliveredOrders: number; revenue: number; lowStock: Array<{ id: number; name: string; stock: number; reorderLevel: number; pharmacyName: string }>; recentOrders: Array<{ id: number; orderNumber: string; status: string; total: number; pharmacyName: string; createdAt: string }> }
type PendingPharmacy = { id: number; name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; drugLicenseNumber: string | null; approvalStatus: string; rejectionReason: string | null; registrationNumber: string | null; licenseNumber: string | null; authorizedPharmacistName: string | null; authorizedPharmacistRegistration: string | null; evidenceUrl: string | null; submittedAt: string | null }

function AdminPage({ session, onSignOut }: { session: AccountSession; onSignOut: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [pending, setPending] = useState<PendingPharmacy[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void Promise.all([authenticatedApiFetch('/api/admin/overview', session.token), authenticatedApiFetch('/api/admin/pharmacies/pending', session.token)]).then(async ([overviewResponse, pendingResponse]) => { const result = await overviewResponse.json(); const applications = await pendingResponse.json(); if (!overviewResponse.ok) throw new Error(result.error); if (!pendingResponse.ok) throw new Error(applications.error); setData(result); setPending(applications) }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load administration data.')) }, [session.token])
  const decide = async (id: number, decision: 'approved' | 'rejected' | 'revoked') => { const reason = decision === 'approved' ? '' : window.prompt(`Reason for ${decision}:`) || ''; if (decision !== 'approved' && !reason) return; const response = await authenticatedApiFetch(`/api/admin/pharmacies/${id}/decision`, session.token, { method: 'POST', body: JSON.stringify({ decision, reason }) }); if (!response.ok) { const result = await response.json(); setError(result.error || 'Decision failed.'); return }; setPending((items) => items.filter((item) => item.id !== id)) }
  return <main className="admin-page"><header className="admin-header"><div><div className="brand-mark">P+</div><h1>Administration</h1><p>Platform-wide pharmacy operations</p></div><button className="quiet-action" onClick={onSignOut}><LogOut className="icon" /> Sign out</button></header>{error && <p className="auth-error">{error}</p>}{!data ? <p>Loading dashboard…</p> : <><section className="admin-stats"><article><span>Customers</span><strong>{data.accounts.customer || 0}</strong></article><article><span>Pharmacy owners</span><strong>{data.accounts.pharmacy_owner || 0}</strong></article><article><span>Pharmacies</span><strong>{data.pharmacies}</strong></article><article><span>Delivered revenue</span><strong>₹{data.revenue.toFixed(2)}</strong></article></section><section className="admin-review-panel"><h2>Pharmacy applications</h2>{pending.length ? pending.map((item) => <article className="admin-application" key={item.id}><div><h3>{item.name}</h3><p>{item.city || 'Location pending'} · status: <strong>{item.approvalStatus}</strong></p><p>Registration: {item.registrationNumber || '—'} · License: {item.licenseNumber || item.drugLicenseNumber || '—'}</p><p>Authorized pharmacist: {item.authorizedPharmacistName || '—'} ({item.authorizedPharmacistRegistration || '—'})</p>{item.evidenceUrl && <a href={item.evidenceUrl} target="_blank" rel="noreferrer">Open evidence link</a>}{item.rejectionReason && <p className="owner-form-error">Reason: {item.rejectionReason}</p>}</div><div className="admin-application-actions"><button className="primary-cta dark" onClick={() => void decide(item.id, 'approved')}>Approve</button><button className="quiet-action danger-action" onClick={() => void decide(item.id, 'rejected')}>Reject</button><button className="quiet-action" onClick={() => void decide(item.id, 'revoked')}>Revoke</button></div></article>) : <p>No pending pharmacy applications.</p>}</section><section className="admin-grid"><article><h2>Low-stock inventory</h2>{data.lowStock.length ? data.lowStock.map((item) => <p key={item.id}><strong>{item.name}</strong> — {item.stock}/{item.reorderLevel} · {item.pharmacyName}</p>) : <p>All active inventory is above its reorder level.</p>}</article><article><h2>Recent orders</h2>{data.recentOrders.map((order) => <p key={order.id}><strong>{order.orderNumber}</strong> — {order.status} · ₹{order.total.toFixed(2)}</p>)}</article></section></>}</main>
}

function DashboardPage({
  ownerSession,
  onCatalogChange,
  onSignOut,
}: {
  ownerSession: OwnerSession
  onCatalogChange: () => void
  onSignOut: () => void
}) {
  const { section, orderId } = useParams()
  const navigate = useNavigate()
  const [fontScale, setFontScale] = useState(() => {
    const saved = Number(localStorage.getItem(`pharma-plus-owner-font-${ownerSession.user.id}`))
    return Number.isFinite(saved) && saved >= 0.9 && saved <= 1.2 ? saved : 1
  })
  const activeSection = section ?? 'home'
  const sectionTitles: Record<string, string> = {
    home: `Welcome, ${ownerSession.user.fullName}`,
    orders: 'Orders',
    prescriptions: 'Prescription review',
    medicines: 'Medicines',
    delivery: 'Delivery',
    verification: 'Pharmacy verification',
  }

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen dashboard-screen" style={{ zoom: fontScale }}>
      <div className="dashboard-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark">P+</div>
            <div>
              <span className="brand-label">Pharma Plus</span>
              <strong>{ownerSession.user.pharmacyName}</strong>
            </div>
          </div>
          <nav className="sidebar-nav">
            {sidebarItems.map(({ label, icon: Icon }) => (
              <NavLink
                key={label}
                end={label === 'Home'}
                to={label === 'Home' ? '/dashboard' : `/dashboard/${label.toLowerCase()}`}
                className={({ isActive }) => (isActive ? 'sidebar-item active' : 'sidebar-item')}
              >
                <Icon className="icon" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="dashboard-main">
          <header className="dashboard-header">
            <div>
              {activeSection !== 'home' && <BackButton fallback="/dashboard" />}
              <h2>{sectionTitles[activeSection] ?? 'Pharmacy'}</h2>
              <small>{activeSection === 'home' ? 'Your pharmacy workspace and live inventory overview.' : `Manage your pharmacy ${activeSection} at a glance.`}</small>
            </div>
            <div className="header-actions">
              <label className="owner-font-control"><span>Text size</span><input aria-label="Owner dashboard text size" type="range" min="0.9" max="1.2" step="0.05" value={fontScale} onChange={(event) => {
                const nextScale = Number(event.target.value)
                setFontScale(nextScale)
                localStorage.setItem(`pharma-plus-owner-font-${ownerSession.user.id}`, String(nextScale))
              }} /><strong>{Math.round(fontScale * 100)}%</strong></label>
              <button className="icon-button light" aria-label="View order notifications" onClick={() => navigate('/dashboard/orders')}><BellRing className="icon" /></button>
              <span className="owner-email">{ownerSession.user.fullName} · {ownerSession.user.email}</span>
              <button className="quiet-action owner-logout" onClick={onSignOut}><LogOut className="icon" /> Sign out</button>
            </div>
          </header>

          {activeSection === 'home' && (
            <PharmacyOverviewScreen
              session={ownerSession}
              onOpenInventory={() => navigate('/dashboard/medicines')}
              onOpenOrders={() => navigate('/dashboard/orders')}
              onOpenOrder={(id) => navigate(`/dashboard/orders/${id}`)}
            />
          )}

          {activeSection === 'orders' && <PharmacyOrdersScreen token={ownerSession.token} orderId={orderId} />}
          {activeSection === 'prescriptions' && <PharmacyPrescriptionScreen token={ownerSession.token} />}
          {activeSection === 'delivery' && (
            <>
              <MarketplaceSettingsScreen token={ownerSession.token} />
              <PharmacyOrdersScreen token={ownerSession.token} orderId={orderId} />
            </>
          )}
          {activeSection === 'medicines' && <PharmacyMedicinesScreen onCatalogChange={onCatalogChange} token={ownerSession.token} />}
          {activeSection === 'verification' && <PharmacyVerificationScreen token={ownerSession.token} />}
        </main>
      </div>
    </motion.div>
  )
}

function MarketplaceSettingsScreen({ token }: { token: string }) {
  const [form, setForm] = useState({ latitude: '', longitude: '', deliveryFee: '', pickupAvailable: true })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadSettings = async () => {
      try {
        const response = await ownerApiFetch('/api/owner/marketplace-settings', token)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load marketplace settings.')
        if (!cancelled) setForm({
          latitude: result.latitude === null ? '' : String(result.latitude),
          longitude: result.longitude === null ? '' : String(result.longitude),
          deliveryFee: result.deliveryFee === '' ? '' : String(result.deliveryFee),
          pickupAvailable: result.pickupAvailable,
        })
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load marketplace settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadSettings()
    return () => { cancelled = true }
  }, [token])

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await ownerApiFetch('/api/owner/marketplace-settings', token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: form.latitude.trim() ? Number(form.latitude) : null,
          longitude: form.longitude.trim() ? Number(form.longitude) : null,
          deliveryFee: form.deliveryFee.trim() ? Number(form.deliveryFee) : null,
          pickupAvailable: form.pickupAvailable,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save marketplace settings.')
      setMessage('Marketplace information saved. Customers will see your pickup, fee, and approximate distance details.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save marketplace settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="marketplace-settings-panel">
      <div className="pharmacy-page-heading">
        <div><h3>Marketplace listing details</h3><p>Set disclosed delivery fees, pickup availability, and optional coordinates for approximate distance.</p></div>
      </div>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {message && <p className="verification-success" role="status">{message}</p>}
      {loading ? <p className="inventory-note">Loading marketplace settings…</p> : (
        <form className="marketplace-settings-form" onSubmit={(event) => void saveSettings(event)}>
          <label>Delivery fee (₹)
            <input type="number" min="0" max="100000" step="0.01" placeholder="Leave blank if not disclosed" value={form.deliveryFee} onChange={(event) => setForm((current) => ({ ...current, deliveryFee: event.target.value }))} />
          </label>
          <label className="marketplace-pickup-toggle">
            <input type="checkbox" checked={form.pickupAvailable} onChange={(event) => setForm((current) => ({ ...current, pickupAvailable: event.target.checked }))} />
            <span>Customers can pick up orders from this pharmacy</span>
          </label>
          <div className="marketplace-coordinate-note">Coordinates are used only for approximate straight-line distance; no reverse geocoding is performed.</div>
          <label>Latitude
            <input type="number" min="-90" max="90" step="any" placeholder="Optional" value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))} />
          </label>
          <label>Longitude
            <input type="number" min="-180" max="180" step="any" placeholder="Optional" value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))} />
          </label>
          <button type="submit" className="accept-action" disabled={saving}>{saving ? 'Saving…' : 'Save marketplace details'}</button>
        </form>
      )}
    </section>
  )
}

function PharmacyVerificationScreen({ token }: { token: string }) {
  const [form, setForm] = useState({ registrationNumber: '', licenseNumber: '', authorizedPharmacistName: '', authorizedPharmacistRegistration: '', evidenceUrl: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(''); setError('')
    try { const response = await ownerApiFetch('/api/owner/pharmacy/onboard', token, { method: 'POST', body: JSON.stringify(form) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage(`Application submitted on ${new Date(result.submittedAt).toLocaleString()}. An administrator will review your evidence.`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not submit verification.') }
  }
  return <section className="verification-panel"><div className="pharmacy-page-heading"><div><h3>Submit pharmacy verification</h3><p>Provide registration and pharmacist evidence. Marketplace access stays disabled until approval. Prescription review is available only when this owner account name exactly matches the approved authorized pharmacist name.</p></div></div>{message && <p className="verification-success">{message}</p>}{error && <p className="owner-form-error">{error}</p>}<form className="verification-form" onSubmit={submit}>{[['registrationNumber','Pharmacy registration number'],['licenseNumber','Drug license number'],['authorizedPharmacistName','Authorized pharmacist name'],['authorizedPharmacistRegistration','Pharmacist registration number'],['evidenceUrl','Evidence link (secure document URL)']].map(([key,label]) => <label key={key}>{label}<input required value={form[key as keyof typeof form]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={label} /></label>)}<button className="primary-cta dark" type="submit">Submit for admin review <ArrowUpRight className="icon" /></button></form></section>
}

function PharmacyOverviewScreen({
  session,
  onOpenInventory,
  onOpenOrders,
  onOpenOrder,
}: {
  session: OwnerSession
  onOpenInventory: () => void
  onOpenOrders: () => void
  onOpenOrder: (id: number) => void
}) {
  const [inventory, setInventory] = useState<InventoryRecord[]>([])
  const [movements, setMovements] = useState<Array<{ id: number; type: string; quantityChange: number; note: string | null; createdAt: string; medicineName: string; sku: string | null }>>([])
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const loadInventory = async () => {
      try {
        const [inventoryResponse, movementResponse, ordersResponse] = await Promise.all([
          ownerApiFetch('/api/medicines', session.token),
          ownerApiFetch('/api/owner/stock-movements', session.token),
          ownerApiFetch('/api/owner/orders', session.token),
        ])
        const [inventoryResult, movementResult, ordersResult] = await Promise.all([inventoryResponse.json(), movementResponse.json(), ordersResponse.json()])
        if (!inventoryResponse.ok) throw new Error(inventoryResult.error || 'Could not load your inventory.')
        if (!movementResponse.ok) throw new Error(movementResult.error || 'Could not load stock movement history.')
        if (!ordersResponse.ok) throw new Error(ordersResult.error || 'Could not load recent pharmacy orders.')
        if (!cancelled) {
          setInventory(inventoryResult as InventoryRecord[])
          setMovements(movementResult)
          setOrders(ordersResult as CustomerOrder[])
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load your inventory.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    // Load only inventory owned by the authenticated pharmacy.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadInventory()
    return () => {
      cancelled = true
    }
  }, [session.token])

  const lowStock = inventory
    .filter((item) => item.stock <= item.reorderLevel)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 4)
  const expiringSoon = inventory.filter((item) => {
    if (!item.expiry) return false
    const expiresAt = new Date(`${item.expiry.slice(0, 10)}T00:00:00`)
    const daysRemaining = (expiresAt.getTime() - now) / 86400000
    return daysRemaining >= 0 && daysRemaining <= 30
  })
  const address = [
    session.user.pharmacyAddress,
    session.user.pharmacyCity,
    session.user.pharmacyState,
    session.user.pharmacyPostalCode,
  ].filter(Boolean).join(', ')

  return (
    <section className="pharmacy-overview">
      <article className="pharmacy-welcome-card">
        <div>
          <span className="eyebrow">YOUR PHARMACY</span>
          <h3>{session.user.pharmacyName}</h3>
          <p>Welcome, {session.user.fullName}. This workspace and inventory belong to your pharmacy.</p>
          <button className="accept-action" onClick={onOpenInventory}><Pill className="icon" /> Manage medicines</button>
        </div>
        <div className="pharmacy-welcome-mark"><span>P+</span></div>
      </article>

      <div className="pharmacy-owner-details">
        <div><span>Owner account</span><strong>{session.user.email}</strong></div>
        <div><span>Contact</span><strong>{session.user.pharmacyPhone || session.user.phone || 'Not added'}</strong></div>
        <div><span>Pharmacy address</span><strong>{address || 'Add an address to your pharmacy profile'}</strong></div>
      </div>

      <div className="inventory-overview-grid">
        <article className="inventory-overview-card">
          <span className="inventory-overview-icon"><Pill className="icon" /></span>
          <span>Active products</span>
          <strong>{loading ? '—' : inventory.length}</strong>
        </article>
        <article className="inventory-overview-card">
          <span className="inventory-overview-icon warning"><BadgeAlert className="icon" /></span>
          <span>Low stock</span>
          <strong>{loading ? '—' : inventory.filter((item) => item.stock > 0 && item.stock <= item.reorderLevel).length}</strong>
        </article>
        <article className="inventory-overview-card">
          <span className="inventory-overview-icon danger"><Package className="icon" /></span>
          <span>Out of stock</span>
          <strong>{loading ? '—' : inventory.filter((item) => item.stock === 0).length}</strong>
        </article>
        <article className="inventory-overview-card">
          <span className="inventory-overview-icon"><PackageCheck className="icon" /></span>
          <span>Units on hand</span>
          <strong>{loading ? '—' : inventory.reduce((sum, item) => sum + item.stock, 0).toLocaleString('en-IN')}</strong>
        </article>
        <article className="inventory-overview-card">
          <span className="inventory-overview-icon warning"><CalendarDays className="icon" /></span>
          <span>Expiring in 30 days</span>
          <strong>{loading ? '—' : expiringSoon.length}</strong>
        </article>
      </div>

      <div className="owner-tracking-grid">
      <section className="pharmacy-low-stock">
        <div className="pharmacy-page-heading">
          <div><h3>Inventory attention</h3><p>Stock status from your saved medicine records.</p></div>
          <button className="text-action" onClick={onOpenInventory}>View inventory</button>
        </div>
        {error && <p className="owner-form-error" role="alert">{error}</p>}
        {loading ? <p className="inventory-note">Loading your inventory…</p> : lowStock.length ? (
          <div className="low-stock-list">
            {lowStock.map((item) => (
              <div className="low-stock-row" key={item.id}>
                <span className="low-stock-pip"><Pill className="icon" /></span>
                <div><strong>{item.name}</strong><small>{item.category} · alert at {item.reorderLevel}</small></div>
                <span className={item.stock === 0 ? 'danger-tag' : 'warning-tag'}>
                  {item.stock === 0 ? 'Out of stock' : `${item.stock} left`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state-card compact-empty">No low-stock medicines in your inventory.</div>
        )}
        <div className="expiry-attention">
          <h4>Expiring soon</h4>
          {expiringSoon.length ? expiringSoon.slice(0, 5).map((item) => (
            <div className="expiry-attention-row" key={item.id}><strong>{item.name}</strong><span>{new Date(`${item.expiry!.slice(0, 10)}T00:00:00`).toLocaleDateString()}</span></div>
          )) : <p>No medicines expire in the next 30 days.</p>}
        </div>
      </section>
      <section className="stock-movement-panel">
        <div className="pharmacy-page-heading"><div><h3>Recent stock activity</h3><p>Receipts, adjustments and order deductions.</p></div></div>
        {loading ? <p className="inventory-note">Loading movement history…</p> : movements.length ? (
          <div className="stock-movement-list">{movements.slice(0, 12).map((movement) => (
            <article key={movement.id}>
              <span className={movement.quantityChange < 0 ? 'stock-movement-icon decrease' : 'stock-movement-icon'}>{movement.quantityChange < 0 ? <Minus className="icon" /> : <Plus className="icon" />}</span>
              <div><strong>{movement.medicineName}</strong><small>{movement.note || movement.type} · {new Date(movement.createdAt).toLocaleString()}</small></div>
              <b className={movement.quantityChange < 0 ? 'decrease' : ''}>{movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}</b>
            </article>
          ))}</div>
        ) : <div className="empty-state-card compact-empty">Stock changes will be tracked here.</div>}
      </section>
      <section className="owner-recent-orders">
        <div className="pharmacy-page-heading"><div><h3>Recent order activity</h3><p>Customer orders and current fulfillment status.</p></div><button type="button" className="text-action" onClick={onOpenOrders}>View all</button></div>
        {loading ? <p className="inventory-note">Loading recent orders…</p> : orders.length ? (
          <div className="owner-recent-order-list">{orders.slice(0, 4).map((order) => (
            <button type="button" key={order.id} onClick={() => onOpenOrder(order.id)}>
              <span className="owner-recent-order-icon"><ShoppingBag className="icon" /></span>
              <span><strong>{order.orderNumber}</strong><small>{order.status === 'accepted' ? 'Accepted' : orderStatusLabel[order.status] ?? order.status} · {order.items.length} items</small></span>
              <strong>₹{order.total.toLocaleString('en-IN')}</strong>
            </button>
          ))}</div>
        ) : <div className="empty-state-card compact-empty">New customer orders will appear here.</div>}
      </section>
      </div>
    </section>
  )
}

function PharmacyOrdersScreen({ token, orderId }: { token: string; orderId?: string }) {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [otpInputs, setOtpInputs] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const loadOrders = useCallback(async () => {
    try {
      const response = await ownerApiFetch('/api/owner/orders', token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load pharmacy orders.')
      setOrders(result as CustomerOrder[])
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load pharmacy orders.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    // Keep pharmacy fulfillment status synchronized with new customer orders.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadOrders()
    const timer = window.setInterval(() => void loadOrders(), 15000)
    return () => window.clearInterval(timer)
  }, [loadOrders])

  const updateStatus = async (order: CustomerOrder, status: string) => {
    setSavingId(order.id)
    setError('')
    try {
      const response = await ownerApiFetch(`/api/owner/orders/${order.id}/status`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, otp: otpInputs[order.id] ?? '' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update order status.')
      setOrders((current) => current.map((entry) => entry.id === order.id ? result as CustomerOrder : entry))
      setOtpInputs((current) => ({ ...current, [order.id]: '' }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update order status.')
    } finally {
      setSavingId(null)
    }
  }

  const visibleOrders = orderId
    ? orders.filter((order) => order.id === Number(orderId))
    : orders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter
      const matchesSearch = !search.trim() || `${order.orderNumber} ${order.customerName ?? ''} ${order.customerPhone ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
      return matchesStatus && matchesSearch
    })

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div>{orderId && <BackButton fallback="/dashboard/orders" />}<h3>{orderId ? 'Order fulfillment' : 'Orders'}</h3><p>{orderId ? 'Review this order, update its status, and verify delivery.' : 'Track each handoff from order placement through verified delivery.'}</p></div>
        <span className="count-badge">{orders.filter((order) => !['delivered', 'declined', 'cancelled'].includes(order.status)).length} active</span>
      </div>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {!orderId && (
        <div className="owner-order-controls">
          <label><Search className="icon" /><input type="search" placeholder="Search by order ID or customer…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="order-filter-tabs" role="group" aria-label="Filter pharmacy orders">
            {['all', 'pending', 'accepted', 'preparing', 'out_for_delivery', 'delivered'].map((status) => <button type="button" className={statusFilter === status ? 'active' : ''} key={status} onClick={() => setStatusFilter(status)}>{status === 'all' ? 'All' : status === 'preparing' ? 'Preparing' : status === 'out_for_delivery' ? 'Out for delivery' : status[0].toUpperCase() + status.slice(1)}</button>)}
          </div>
        </div>
      )}
      {loading ? <div className="empty-state-card compact-empty">Loading pharmacy orders…</div> : visibleOrders.length ? (
        <div className="owner-orders-list">{visibleOrders.map((order) => (
          <article className="owner-order-card" key={order.id}>
            <header><div><small>DELIVERY ID</small><strong>{order.orderNumber}</strong></div><span className={`order-status-pill ${order.status}`}>{orderStatusLabel[order.status] ?? order.status}</span></header>
            {!orderId && <button type="button" className="fulfillment-open-button" onClick={() => navigate(`/dashboard/orders/${order.id}`)}>Open fulfillment <ArrowUpRight className="icon" /></button>}
            <p className="owner-order-meta">Placed {new Date(order.createdAt).toLocaleString()} · ₹{order.total.toLocaleString('en-IN')}</p>
            <p className="owner-order-customer">{order.customerName || 'Customer'}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</p>
            <div className="owner-order-items">{order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {formatOrderItemQuantity(item)}{item.prescriptionRequired && <small> · Prescription #{item.prescriptionId} approved</small>}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}</div>
            <p className="customer-order-address"><MapPin className="icon" /> {order.fulfillmentMethod === 'pickup' ? 'Pharmacy pickup' : formatOrderLocation(order)}</p>
            <OrderTimeline order={order} />
            {order.status === 'pending' && <div className="owner-order-actions"><button type="button" className="decline-action" disabled={savingId === order.id} onClick={() => void updateStatus(order, 'declined')}>Decline</button><button type="button" className="accept-action" disabled={savingId === order.id} onClick={() => void updateStatus(order, 'accepted')}>{savingId === order.id ? 'Saving…' : 'Accept order'}</button></div>}
            {order.status === 'accepted' && <button type="button" className="accept-action owner-order-primary" disabled={savingId === order.id} onClick={() => void updateStatus(order, 'preparing')}>{savingId === order.id ? 'Saving…' : 'Mark packed'}</button>}
            {order.status === 'preparing' && <button type="button" className="accept-action owner-order-primary" disabled={savingId === order.id} onClick={() => void updateStatus(order, 'out_for_delivery')}>{savingId === order.id ? 'Saving…' : 'Start delivery'}</button>}
            {order.status === 'out_for_delivery' && <div className="owner-otp-entry"><label>Customer delivery code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={otpInputs[order.id] ?? ''} onChange={(event) => setOtpInputs((current) => ({ ...current, [order.id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /></label><button type="button" className="accept-action" disabled={savingId === order.id || (otpInputs[order.id] ?? '').length !== 6} onClick={() => void updateStatus(order, 'delivered')}>{savingId === order.id ? 'Verifying…' : 'Verify & mark delivered'}</button></div>}
          </article>
        ))}</div>
      ) : <div className="empty-state-card orders-empty-state"><span className="empty-state-icon-wrap"><ShoppingBag className="icon" /></span><h2>{orderId ? 'Order not found' : 'No orders yet'}</h2><p>{orderId ? 'This order is not part of your pharmacy account.' : 'New customer orders will appear here and update automatically.'}</p></div>}
    </section>
  )
}

function PharmacyPrescriptionScreen({ token }: { token: string }) {
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPrescriptions = useCallback(async () => {
    try {
      const response = await ownerApiFetch('/api/owner/prescriptions', token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load prescription reviews.')
      setPrescriptions(result as PrescriptionRecord[])
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load prescription reviews.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    // Keep new prescription submissions visible without exposing public file links.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadPrescriptions()
    const timer = window.setInterval(() => void loadPrescriptions(), 15000)
    return () => window.clearInterval(timer)
  }, [loadPrescriptions])

  const review = async (id: number, decision: string, values: Record<string, unknown>) => {
    const response = await ownerApiFetch(`/api/owner/prescriptions/${id}/review`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, decision }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not save this prescription decision.')
    await loadPrescriptions()
  }

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Prescription verification queue</h3><p>Confirm patient and prescriber identity, each requested medicine and quantity, document dates, and applicable legal requirements before approval.</p></div>
        <span className="count-badge">{prescriptions.filter((item) => item.status === 'pending' || item.status === 'correction_required').length} awaiting review</span>
      </div>
      <p className="prescription-privacy-note">Only the pharmacist named in this pharmacy’s approved verification can open documents or submit a decision. Files are downloaded through authenticated, no-cache endpoints.</p>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {loading ? <div className="empty-state-card compact-empty">Loading prescription reviews…</div> : prescriptions.length ? (
        <div className="prescription-review-list">
          {prescriptions.map((prescription) => (
            <PrescriptionReviewCard key={prescription.id} prescription={prescription} token={token} onReview={review} />
          ))}
        </div>
      ) : <div className="empty-state-card compact-empty">No prescriptions are waiting for your pharmacy.</div>}
    </section>
  )
}

function PrescriptionReviewCard({
  prescription,
  token,
  onReview,
}: {
  prescription: PrescriptionRecord
  token: string
  onReview: (id: number, decision: string, values: Record<string, unknown>) => Promise<void>
}) {
  const [prescriptionDate, setPrescriptionDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [reason, setReason] = useState('')
  const [patientMatches, setPatientMatches] = useState(false)
  const [prescriberValid, setPrescriberValid] = useState(false)
  const [legalRequirementsSatisfied, setLegalRequirementsSatisfied] = useState(false)
  const [medicineMatches, setMedicineMatches] = useState<Record<number, boolean>>({})
  const [approvedQuantities, setApprovedQuantities] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const approvalReady = prescription.documentAvailable &&
    reason.trim().length >= 3 &&
    prescriptionDate.length > 0 &&
    validUntil.length > 0 &&
    patientMatches &&
    prescriberValid &&
    legalRequirementsSatisfied &&
    prescription.items.every((item) =>
      medicineMatches[item.medicineId] === true &&
      Number.isSafeInteger(Number(approvedQuantities[item.medicineId] ?? item.requestedQuantity)) &&
      Number(approvedQuantities[item.medicineId] ?? item.requestedQuantity) >= item.requestedQuantity &&
      Number(approvedQuantities[item.medicineId] ?? item.requestedQuantity) <= 10000,
    )

  const downloadDocument = async () => {
    setDownloading(true)
    setError('')
    try {
      const response = await ownerApiFetch(`/api/owner/prescriptions/${prescription.id}/file`, token)
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Could not download the prescription document.')
      }
      const blobUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `prescription-${prescription.id}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not download the prescription document.')
    } finally {
      setDownloading(false)
    }
  }

  const submitReview = async (decision: 'approved' | 'rejected' | 'correction_requested') => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const items = prescription.items.map((item) => ({
        medicineId: item.medicineId,
        medicineMatches: medicineMatches[item.medicineId] === true,
        approvedQuantity: Number(approvedQuantities[item.medicineId] ?? item.requestedQuantity),
      }))
      await onReview(prescription.id, decision, {
        reason,
        prescriptionDate,
        validUntil,
        patientMatches,
        prescriberValid,
        legalRequirementsSatisfied,
        items,
      })
      setMessage(decision === 'approved' ? 'Prescription approved for the recorded quantities.' : `Prescription ${decision === 'rejected' ? 'rejected' : 'returned for correction'}.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save this prescription decision.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="prescription-review-card">
      <header>
        <div><strong>Prescription #{prescription.id}</strong><span>Customer: {prescription.customerName || 'Customer'} · submitted {new Date(prescription.submittedAt).toLocaleString()}</span></div>
        <span className={`order-status-pill ${prescription.status}`}>{prescription.status.replace('_', ' ')}</span>
      </header>
      {prescription.validUntil && <p>Valid through {prescription.validUntil}</p>}
      {prescription.reviewReason && <p className="prescription-review-note">Previous decision: {prescription.reviewReason}</p>}
      {prescription.documentAvailable ? (
        <button type="button" className="quiet-action" disabled={downloading} onClick={() => void downloadDocument()}>
          {downloading ? 'Retrieving securely…' : 'Download document securely'}
        </button>
      ) : <p className="owner-form-error">The private document has been deleted under the retention policy.</p>}
      {prescription.status !== 'approved' && prescription.documentAvailable && (
        <>
          <div className="prescription-requested-items">
            {prescription.items.map((item) => (
              <div className="prescription-requested-item" key={item.medicineId}>
                <strong>{item.name} · requested {item.requestedQuantity} pack(s)</strong>
                <label className="prescription-review-check">
                  <input type="checkbox" checked={medicineMatches[item.medicineId] ?? false} onChange={(event) => setMedicineMatches((current) => ({ ...current, [item.medicineId]: event.target.checked }))} />
                  <span>Medicine matches the prescription</span>
                </label>
                <label>Approved quantity (packs)
                  <input type="number" min={item.requestedQuantity} max="10000" value={approvedQuantities[item.medicineId] ?? String(item.requestedQuantity)} onChange={(event) => setApprovedQuantities((current) => ({ ...current, [item.medicineId]: event.target.value }))} />
                </label>
              </div>
            ))}
          </div>
          <div className="prescription-review-checks">
            <label className="prescription-review-check"><input type="checkbox" checked={patientMatches} onChange={(event) => setPatientMatches(event.target.checked)} /><span>Patient identity matches the customer</span></label>
            <label className="prescription-review-check"><input type="checkbox" checked={prescriberValid} onChange={(event) => setPrescriberValid(event.target.checked)} /><span>Prescriber is valid</span></label>
            <label className="prescription-review-check"><input type="checkbox" checked={legalRequirementsSatisfied} onChange={(event) => setLegalRequirementsSatisfied(event.target.checked)} /><span>Applicable legal requirements are satisfied</span></label>
          </div>
          <div className="prescription-review-dates">
            <label>Prescription date<input type="date" value={prescriptionDate} onChange={(event) => setPrescriptionDate(event.target.value)} /></label>
            <label>Valid through<input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
          </div>
          <label className="prescription-review-reason">Decision reason / customer instructions
            <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
            <small>A concise reason is retained with the review. Avoid unrelated health details.</small>
          </label>
          <div className="prescription-review-actions">
            <button type="button" className="accept-action" disabled={saving || !approvalReady} onClick={() => void submitReview('approved')}>{saving ? 'Saving…' : 'Approve'}</button>
            <button type="button" className="quiet-action" disabled={saving || reason.trim().length < 3} onClick={() => void submitReview('correction_requested')}>Request correction</button>
            <button type="button" className="decline-action" disabled={saving || reason.trim().length < 3} onClick={() => void submitReview('rejected')}>Reject</button>
          </div>
        </>
      )}
      {prescription.status === 'approved' && (
        <>
          <label className="prescription-review-reason">Reason for revoking approval
            <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="button" className="decline-action" disabled={saving || reason.trim().length < 3} onClick={() => void submitReview('rejected')}>Revoke approval</button>
        </>
      )}
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {message && <p className="verification-success" role="status">{message}</p>}
      <small>Document retention ends {prescription.retentionUntil}; the file is automatically deleted after that date.</small>
    </article>
  )
}

function PharmacyMedicinesScreen({ onCatalogChange, token }: { onCatalogChange: () => void; token: string }) {
  const [inventory, setInventory] = useState<InventoryRecord[]>([])
  const [movements, setMovements] = useState<Array<{ id: number; type: string; quantityChange: number; note: string | null; createdAt: string; medicineName: string; sku: string | null }>>([])
  const [form, setForm] = useState<MedicineForm | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [stepError, setStepError] = useState('')
  const [inventorySearch, setInventorySearch] = useState('')
  const [inventoryCategory, setInventoryCategory] = useState('All categories')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadInventory = useCallback(async () => {
    try {
      const [response, movementsResponse] = await Promise.all([
        ownerApiFetch('/api/medicines', token),
        ownerApiFetch('/api/owner/stock-movements', token),
      ])
      const [result, movementResult] = await Promise.all([response.json(), movementsResponse.json()])
      if (!response.ok) throw new Error(result.error || 'Could not load medicines.')
      if (!movementsResponse.ok) throw new Error(movementResult.error || 'Could not load stock movement history.')
      setInventory(result as InventoryRecord[])
      setMovements(movementResult)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load medicines.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    // This effect synchronizes the screen with inventory stored by the API.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadInventory()
  }, [loadInventory])

  const startEdit = (item: InventoryRecord) => {
    setEditingId(item.id)
    setStepError('')
    setForm({
      name: item.name,
      brandName: item.brandName ?? '',
      category: item.category,
      pack: item.pack,
      strength: item.strength ?? '',
      dosageForm: item.dosageForm ?? '',
      packQuantity: item.packQuantity === null ? '' : String(item.packQuantity),
      packUnit: item.packUnit ?? '',
      price: String(item.price),
      stock: String(item.stock),
      reorderLevel: String(item.reorderLevel),
      expiry: item.expiry?.slice(0, 10) ?? '',
      sku: item.sku ?? '',
      genericName: item.genericName ?? '',
      manufacturer: item.manufacturer ?? '',
      batchNumber: item.batchNumber ?? '',
      gstRate: String(item.gstRate),
      hsnCode: item.hsnCode ?? '',
      prescriptionRequired: item.prescriptionRequired,
      description: item.description ?? '',
      imageUrl: item.imageUrl ?? '',
    })
  }

  const saveMedicine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return
    if (!form.name.trim() || !form.category.trim() || !form.pack.trim() || !form.brandName.trim()
      || !form.genericName.trim() || !form.strength.trim() || !form.dosageForm.trim()
      || !form.packQuantity.trim() || !form.packUnit.trim()) {
      setStepError('Complete the brand, generic ingredient, strength, dosage form, and pack dimensions to support safe exact-product matching.')
      return
    }
    if (!Number.isSafeInteger(Number(form.packQuantity)) || Number(form.packQuantity) < 1) {
      setStepError('Pack quantity must be a positive whole number.')
      return
    }
    if ([form.price, form.stock, form.reorderLevel].some((value) =>
      value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0,
    )) {
      setStepError('Enter a valid price, stock quantity, and low-stock alert before saving.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await ownerApiFetch(editingId ? `/api/medicines/${editingId}` : '/api/medicines', token, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          packQuantity: Number(form.packQuantity),
          price: Number(form.price),
          stock: Number(form.stock),
          reorderLevel: Number(form.reorderLevel),
          gstRate: Number(form.gstRate),
          expiry: form.expiry || null,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save medicine.')
      const saved = result as InventoryRecord
      setInventory((current) => editingId
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)))
      onCatalogChange()
      void loadInventory()
      setForm(null)
      setEditingId(null)
      setStepError('')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Could not save medicine.'
      setError(message)
      setStepError(message)
    } finally {
      setSaving(false)
    }
  }

  const changeStock = async (item: InventoryRecord, amount: number) => {
    const stock = Math.max(0, item.stock + amount)
    try {
      const response = await ownerApiFetch(`/api/medicines/${item.id}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, stock }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update stock.')
      const updated = result as InventoryRecord
      setInventory((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
      void loadInventory()
      onCatalogChange()
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update stock.')
    }
  }

  const removeMedicine = async (item: InventoryRecord) => {
    if (!window.confirm(`Archive ${item.name}? It will be removed from active inventory.`)) return
    try {
      const response = await ownerApiFetch(`/api/medicines/${item.id}`, token, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Could not archive medicine.')
      }
      setInventory((current) => current.filter((entry) => entry.id !== item.id))
      onCatalogChange()
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not archive medicine.')
    }
  }

  const inventoryCategories = ['All categories', ...new Set(inventory.map((item) => item.category).sort())]
  const visibleInventory = inventory.filter((item) => {
    const matchesCategory = inventoryCategory === 'All categories' || item.category === inventoryCategory
    const matchesSearch = !inventorySearch.trim() || `${item.name} ${item.brandName ?? ''} ${item.genericName ?? ''} ${item.strength ?? ''} ${item.dosageForm ?? ''} ${item.sku ?? ''} ${item.batchNumber ?? ''} ${item.manufacturer ?? ''}`.toLowerCase().includes(inventorySearch.trim().toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Inventory</h3><p>Keep product availability and stock up to date.</p></div>
        <button
          className="accept-action"
          onClick={() => {
            setEditingId(null)
            setStepError('')
            setForm(emptyMedicineForm())
          }}
        >
          <Plus className="icon" /> Add medicine
        </button>
      </div>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {form && (
        <div className="medicine-editor-backdrop">
          <section className="medicine-editor" role="dialog" aria-modal="true" aria-labelledby="medicine-editor-title">
            <header className="medicine-editor-header">
              <div className="medicine-editor-brand"><span className="medicine-editor-brand-icon"><Pill className="icon" /></span><span>INVENTORY STUDIO</span></div>
              <button type="button" className="medicine-editor-close" aria-label="Close medicine editor" onClick={() => setForm(null)}><X className="icon" /></button>
            </header>
            <form className="medicine-editor-form" onSubmit={saveMedicine}>
              <div className="medicine-editor-step-heading"><span>PRODUCT CATALOG</span><h4>Medicine information</h4></div>
              {stepError && <p className="medicine-editor-error" role="alert">{stepError}</p>}
              <p className="inventory-note">Exact-match listings require the same brand, generic ingredient, strength, dosage form, and pack dimensions. Enter these from the product packaging.</p>
              <div className="medicine-editor-fields">
                <label className="medicine-field-wide">Medicine name<input autoFocus required placeholder="e.g. Paracetamol 500 mg" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                <label>Brand<input required placeholder="Brand as printed on pack" value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} /></label>
                <label>Generic ingredient<input required placeholder="Active ingredient(s)" value={form.genericName} onChange={(event) => setForm({ ...form, genericName: event.target.value })} /></label>
                <label>Strength<input required placeholder="e.g. 500 mg" value={form.strength} onChange={(event) => setForm({ ...form, strength: event.target.value })} /></label>
                <label>Dosage form<input required placeholder="e.g. tablet, capsule, syrup" value={form.dosageForm} onChange={(event) => setForm({ ...form, dosageForm: event.target.value })} /></label>
                <label>Pack quantity<input required type="number" min="1" step="1" placeholder="e.g. 10" value={form.packQuantity} onChange={(event) => setForm({ ...form, packQuantity: event.target.value })} /></label>
                <label>Pack unit<input required placeholder="e.g. tablets, capsules, mL" value={form.packUnit} onChange={(event) => setForm({ ...form, packUnit: event.target.value })} /></label>
                <label>Category<input required list="medicine-category-options" placeholder="Choose or type a category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /><datalist id="medicine-category-options">{categories.map((category) => <option key={category.name} value={category.name} />)}</datalist></label>
                <label>Pack size<input required placeholder="e.g. 10 tablets" value={form.pack} onChange={(event) => setForm({ ...form, pack: event.target.value })} /></label>
                <label>Sale price (₹)<input required type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
                <label>Stock quantity<input required type="number" min="0" step="1" placeholder="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
                <label>Low-stock alert<input required type="number" min="0" step="1" placeholder="0" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} /></label>
                <label>Expiry date<input type="date" value={form.expiry} onChange={(event) => setForm({ ...form, expiry: event.target.value })} /></label>
                <label>SKU / barcode<input placeholder="Optional" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
                <label>Manufacturer<input placeholder="Optional" value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} /></label>
                <label>Batch number<input placeholder="Optional" value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} /></label>
                <label>GST rate (%)<input type="number" min="0" max="100" step="0.01" value={form.gstRate} onChange={(event) => setForm({ ...form, gstRate: event.target.value })} /></label>
                <label>HSN code<input placeholder="Optional" value={form.hsnCode} onChange={(event) => setForm({ ...form, hsnCode: event.target.value })} /></label>
                <label className="medicine-field-wide">Product description<textarea rows={3} placeholder="Add helpful details about this product" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                <label className="medicine-field-wide">Image URL<input type="url" placeholder="https://…" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></label>
                <label className="medicine-prescription-toggle"><input type="checkbox" checked={form.prescriptionRequired} onChange={(event) => setForm({ ...form, prescriptionRequired: event.target.checked })} /><span><strong>Prescription required</strong><small>Mark this product as prescription-only.</small></span></label>
              </div>
              <footer className="medicine-editor-actions">
                <button type="button" className="quiet-action" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="accept-action" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to inventory'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      <div className="inventory-summary">
        <div><span>Products</span><strong>{inventory.length}</strong></div>
        <div><span>Low stock</span><strong>{inventory.filter((item) => item.stock > 0 && item.stock <= item.reorderLevel).length}</strong></div>
        <div><span>Out of stock</span><strong>{inventory.filter((item) => item.stock === 0).length}</strong></div>
        <div><span>Units on hand</span><strong>{inventory.reduce((sum, item) => sum + item.stock, 0).toLocaleString('en-IN')}</strong></div>
      </div>
      <div className="inventory-filter-bar">
        <label><Search className="icon" /><input type="search" placeholder="Search name, SKU, batch or maker" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} /></label>
        <select aria-label="Filter inventory category" value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)}>
          {inventoryCategories.map((category) => <option key={category}>{category}</option>)}
        </select>
      </div>
      <div className="pharmacy-card-list">
        {visibleInventory.map((item) => (
          <article className="pharmacy-data-card inventory-card" key={item.id}>
            <div className="inventory-product-icon"><Pill className="icon" /></div>
            <div className="inventory-main">
              <div className="data-card-heading">
                <div><h3>{item.name}</h3><p>{item.category} · {item.pack}{item.sku ? ` · ${item.sku}` : ''}</p></div>
                <span className={item.stock === 0 ? 'danger-tag' : item.stock <= item.reorderLevel ? 'warning-tag' : 'status-pill'}>
                  {item.stock === 0 ? 'Out of stock' : item.stock <= item.reorderLevel ? 'Low stock' : 'In stock'}
                </span>
              </div>
              <div className="inventory-details">
                <span>₹{item.price.toLocaleString('en-IN')}</span>
                <span>{item.stock} units · Alert at {item.reorderLevel}</span>
                <span>Exp. {item.expiry ? new Date(`${item.expiry.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Not set'}</span>
              </div>
              <div className="inventory-metadata-grid">
                <span>Generic <strong>{item.genericName || '—'}</strong></span>
                <span>Manufacturer <strong>{item.manufacturer || '—'}</strong></span>
                <span>Batch <strong>{item.batchNumber || '—'}</strong></span>
                <span>SKU / barcode <strong>{item.sku || '—'}</strong></span>
                <span>Tax <strong>{item.gstRate}% · HSN {item.hsnCode || '—'}</strong></span>
                <span>Prescription <strong>{item.prescriptionRequired ? 'Required' : 'Not required'}</strong></span>
              </div>
              {item.description && <p className="inventory-description">{item.description}</p>}
              <div className="inventory-controls">
                <div className="mini-quantity">
                  <button aria-label={`Decrease ${item.name} stock`} disabled={item.stock === 0} onClick={() => void changeStock(item, -1)}><Minus className="icon" /></button>
                  <span>{item.stock}</span>
                  <button aria-label={`Increase ${item.name} stock`} onClick={() => void changeStock(item, 1)}><Plus className="icon" /></button>
                </div>
                <span className="availability-label"><CircleCheck className="icon" /> {item.stock > 0 ? 'Available' : 'Unavailable'}</span>
                <div className="owner-item-actions">
                  <button type="button" className="quiet-action" aria-label={`Edit ${item.name}`} onClick={() => startEdit(item)}><Pencil className="icon" /> Edit</button>
                  <button type="button" className="quiet-action danger-action" aria-label={`Archive ${item.name}`} onClick={() => void removeMedicine(item)}><Trash2 className="icon" /> Archive</button>
                </div>
              </div>
            </div>
          </article>
        ))}
        {loading && <div className="empty-state-card compact-empty">Loading inventory…</div>}
        {!loading && inventory.length === 0 && <div className="empty-state-card compact-empty">No active medicines yet. Add your first product to start managing stock.</div>}
        {!loading && inventory.length > 0 && visibleInventory.length === 0 && <div className="empty-state-card compact-empty">No inventory records match those filters.</div>}
      </div>
      <section className="stock-movement-panel inventory-movement-panel">
        <div className="pharmacy-page-heading"><div><h3>Recent stock movement</h3><p>Receipts, adjustments and order deductions for this pharmacy.</p></div></div>
        {movements.length ? <div className="stock-movement-list">{movements.slice(0, 8).map((movement) => (
          <article key={movement.id}>
            <span className={movement.quantityChange < 0 ? 'stock-movement-icon decrease' : 'stock-movement-icon'}>{movement.quantityChange < 0 ? <Minus className="icon" /> : <Plus className="icon" />}</span>
            <div><strong>{movement.medicineName}</strong><small>{movement.note || movement.type} · {new Date(movement.createdAt).toLocaleString()}</small></div>
            <b className={movement.quantityChange < 0 ? 'decrease' : ''}>{movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}</b>
          </article>
        ))}</div> : <p className="inventory-note">Stock adjustments and order activity will appear here.</p>}
      </section>
    </section>
  )
}


export default App
