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
  category: string
  pack: string
  price: number
  stock: number
  originalPrice?: number
  image: string
  rating?: number
  reviewCount?: number
  description: string
  badge?: string
}

type CartItem = Product & {
  quantity: number
}

type InventoryRecord = {
  id: number
  pharmacyId: number
  pharmacyName: string
  name: string
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
  category: string
  pack: string
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

type AccountRole = 'customer' | 'pharmacy_owner'

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
  address: string
  city: string | null
  state: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
}

type PharmacyChoice = {
  id: number
  name: string
  city: string | null
  state: string | null
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
  deliveryAddress: string
  createdAt: string
  updatedAt: string
  items: Array<{ medicineId: number; name: string; quantity: number; unitPrice: number; lineTotal: number }>
  events: OrderEvent[]
  deliveryOtp?: string
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
  address: string
  city: string
  state: string
  postalCode: string
  latitude: number | null
  longitude: number | null
}

const emptyProfileForm = (): ProfileForm => ({
  fullName: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  latitude: null,
  longitude: null,
})

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
  category: '',
  pack: '',
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
  { label: 'Medicines', icon: Pill },
  { label: 'Delivery', icon: Truck },
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
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])

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
        category: item.category,
        pack: item.pack,
        price: item.price,
        stock: item.stock,
        image: item.imageUrl || '/pharma-plus-icon.png',
        description: item.description || '',
        rating: item.rating,
        reviewCount: item.reviewCount,
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
    if (cart[0] && cart[0].pharmacyId !== product.pharmacyId) {
      setCartError('Your cart contains medicines from another pharmacy. Place that order first or clear your cart.')
      return false
    }
    setCartError('')
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(item.stock, item.quantity + quantity) } : item,
        )
      }
      return [...current, { ...product, quantity: Math.min(product.stock, quantity) }]
    })
    return true
  }

  const toggleFavorite = (productId: number) => {
    setFavoriteIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    )
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

  const total = subtotal + (subtotal > 0 ? 49 : 0) + (subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0)

  return (
    <BrowserRouter>
      <ApplicationRoutes
        cart={cart}
        catalogError={catalogError}
        categories={storeCategories}
        favoriteIds={favoriteIds}
        onAddToCart={handleAddToCart}
        onClearCart={() => setCart([])}
        cartError={cartError}
        onCatalogChange={() => void refreshCatalog()}
        onSelectPharmacy={setSelectedPharmacyId}
        onSelectCategory={setSelectedCategory}
        onToggleFavorite={toggleFavorite}
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
  favoriteIds: number[]
  onAddToCart: (product: Product, quantity: number) => boolean
  onClearCart: () => void
  onCatalogChange: () => void
  onSelectPharmacy: (value: string) => void
  onSelectCategory: (value: string) => void
  onToggleFavorite: (productId: number) => void
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
  favoriteIds,
  onAddToCart,
  onClearCart,
  onCatalogChange,
  onSelectPharmacy,
  onSelectCategory,
  onToggleFavorite,
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
                onAddToCart={onAddToCart}
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
              cartError={cartError}
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
              cartError={cartError}
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
                subtotal={subtotal}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                onClearCart={onClearCart}
                total={total}
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
  onToggleFavorite: (productId: number) => void
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
    const matchesQuery = !query.trim() || `${product.name} ${product.category} ${product.pharmacyName}`.toLowerCase().includes(query.trim().toLowerCase())
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
      </section>

      <section className="home-promo-banner">
        <div><small>EVERYDAY HEALTH ESSENTIALS</small><h2>Care from your<br />neighborhood pharmacy</h2><button type="button" onClick={() => onSelectCategory('All medicines')}>Shop now <ArrowUpRight className="icon" /></button></div>
        <span className="promo-bag" aria-hidden="true"><Plus className="icon" /><Pill className="icon" /></span>
      </section>

      <section className="section-block">
        <div className="section-header">
          <div><h3>Recommended for you</h3><small>Trusted picks from local pharmacies</small></div>
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
  onAddToCart,
  emptyMessage,
}: {
  title: string
  description: string
  products: Product[]
  onToggleFavorite: (productId: number) => void
  onAddToCart: (product: Product, quantity: number) => boolean
  emptyMessage: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const visibleProducts = products.filter((product) =>
    `${product.name} ${product.category} ${product.pharmacyName}`.toLowerCase().includes(query.trim().toLowerCase()),
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
      {error && <p className="owner-form-error" role="alert">{error}</p>}
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
                  if (onAddToCart(product, 1)) navigate('/cart')
                  else setError('Medicines from different pharmacies must be ordered separately.')
                }} aria-label={`Add ${product.name} to cart`}>
                  <ShoppingBag className="icon" /> Add to cart
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
                    <small>{item.pack}</small>
                    <strong>₹{item.price.toLocaleString('en-IN')}</strong>
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
            <div><Truck className="icon" /><span><strong>Home delivery</strong><small>Estimated delivery time is confirmed by the pharmacy.</small></span></div>
          </section>
          <section className="cart-total-card">
            <div><span>Subtotal</span><strong>₹{subtotal.toLocaleString('en-IN')}</strong></div>
            <div><span>Delivery & taxes</span><strong>Calculated at checkout</strong></div>
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
                <div className="customer-order-items">
                  {order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {item.quantity}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}
                </div>
                <div className="customer-order-total"><span>Total</span><strong>₹{order.total.toLocaleString('en-IN')}</strong></div>
                <OrderTimeline order={order} />
                <button type="button" className="track-order-button" onClick={() => navigate(`/orders/${order.id}`)}>View tracking <ArrowUpRight className="icon" /></button>
                {order.status === 'out_for_delivery' && otp && (
                  <div className="delivery-otp-card"><span>Share this delivery code with your pharmacy</span><strong>{otp}</strong><small>Only share when your order arrives.</small></div>
                )}
                <p className="customer-order-address"><MapPin className="icon" /> {order.deliveryAddress}</p>
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
            {order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {item.quantity}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}
            <div className="tracking-total"><span>Order total</span><strong>₹{order.total.toLocaleString('en-IN')}</strong></div>
          </section>
          <section className="tracking-address-card"><MapPin className="icon" /><div><strong>Delivery address</strong><span>{order.deliveryAddress}</span></div></section>
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
  const [editing, setEditing] = useState(false)
  const [locationMode, setLocationMode] = useState<'manual' | 'current'>('manual')
  const [locating, setLocating] = useState(false)
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [profilePhoto, setProfilePhoto] = useState(() => localStorage.getItem(`pharma-plus-profile-photo-${session.user.id}`) || '')

  const applyProfile = (nextProfile: CustomerProfile) => {
    setProfile(nextProfile)
    const address = nextProfile.addresses[0]
    setProfileForm({
      fullName: nextProfile.user.fullName,
      phone: nextProfile.user.phone ?? '',
      address: address?.address ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      postalCode: address?.postalCode ?? '',
      latitude: address?.latitude ?? null,
      longitude: address?.longitude ?? null,
    })
    setLocationMode(address?.latitude != null && address.longitude != null ? 'current' : 'manual')
  }

  useEffect(() => {
    let cancelled = false
    const loadProfile = async () => {
      try {
        const response = await authenticatedApiFetch('/api/customer/profile', session.token)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load your profile.')
        if (!cancelled) applyProfile(result as CustomerProfile)
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load your profile.')
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    // Load the saved profile for the authenticated customer.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [session.token])

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
        setProfileForm((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }))
        setLocating(false)
        setMessage('Location captured on this device. It will be saved with your profile.')
      },
      (locationError) => {
        const locationMessage = locationError.code === locationError.PERMISSION_DENIED
          ? 'Location permission was denied. Allow it in your device settings or enter your address manually.'
          : locationError.code === locationError.POSITION_UNAVAILABLE
            ? 'Your current location is unavailable. Try again or enter your address manually.'
            : 'Location took too long to respond. Try again or enter your address manually.'
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
      const response = await authenticatedApiFetch('/api/customer/profile', session.token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save your profile.')
      applyProfile(result as CustomerProfile)
      setEditing(false)
      setMessage('Your profile was saved.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
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
              <p>Customer account</p>
            </div>
            <button
              className="quiet-action"
              onClick={() => {
                if (editing) applyProfile(profile)
                setEditing((current) => !current)
              }}
            >
              {editing ? 'Cancel' : 'Edit profile'}
            </button>
          </section>
          <div className="profile-shortcuts">
            <button type="button" onClick={() => navigate('/orders')}><ShoppingBag className="icon" /><span><strong>My orders</strong><small>Track deliveries and order again</small></span><ArrowUpRight className="icon" /></button>
            <button type="button" onClick={() => navigate('/favorites')}><Heart className="icon" /><span><strong>Saved medicines</strong><small>Your favorite pharmacy products</small></span><ArrowUpRight className="icon" /></button>
          </div>
          {editing ? (
            <form className="profile-edit-card" onSubmit={saveProfile}>
              <div className="profile-edit-heading">
                <span className="profile-edit-icon"><User className="icon" /></span>
                <div><h2>Your details</h2><p>Keep your contact and delivery location up to date.</p></div>
              </div>
              <div className="profile-input-grid">
                <label>Full name<input required minLength={2} value={profileForm.fullName} onChange={(event) => setProfileForm({ ...profileForm, fullName: event.target.value })} /></label>
                <label>Phone number<input type="tel" autoComplete="tel" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} /></label>
              </div>
              <section className="location-editor">
                <div className="location-editor-heading">
                  <span className="location-editor-icon"><MapPin className="icon" /></span>
                  <div><h3>Delivery location</h3><p>Use your current GPS location or type the address yourself.</p></div>
                </div>
                <div className="location-choice-grid">
                  <button
                    type="button"
                    className={locationMode === 'current' ? 'location-choice selected' : 'location-choice'}
                    aria-pressed={locationMode === 'current'}
                    onClick={() => {
                      setLocationMode('current')
                      setProfileForm((current) => ({
                        ...current,
                        address: '',
                        city: '',
                        state: '',
                        postalCode: '',
                      }))
                      if (profileForm.latitude === null || profileForm.longitude === null) captureCurrentLocation()
                    }}
                  >
                    <MapPin className="icon" />
                    <span><strong>Use current location</strong><small>Ask this device for GPS permission</small></span>
                    {locationMode === 'current' && <Check className="icon location-choice-check" />}
                  </button>
                  <button
                    type="button"
                    className={locationMode === 'manual' ? 'location-choice selected' : 'location-choice'}
                    aria-pressed={locationMode === 'manual'}
                    onClick={() => {
                      setLocationMode('manual')
                      setProfileForm((current) => ({ ...current, latitude: null, longitude: null }))
                      setError('')
                      setMessage('')
                    }}
                  >
                    <Pencil className="icon" />
                    <span><strong>Enter manually</strong><small>Type a street address and city</small></span>
                    {locationMode === 'manual' && <Check className="icon location-choice-check" />}
                  </button>
                </div>
                {locationMode === 'current' ? (
                  <div className="current-location-card">
                    {profileForm.latitude !== null && profileForm.longitude !== null ? (
                      <>
                        <span className="location-live-dot" />
                        <div><strong>Location captured</strong><span>{profileForm.latitude.toFixed(5)}, {profileForm.longitude.toFixed(5)}</span></div>
                        <button type="button" className="text-action" onClick={captureCurrentLocation} disabled={locating}>
                          {locating ? 'Locating…' : 'Refresh'}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="location-live-dot muted" />
                        <div><strong>{locating ? 'Finding your location…' : 'Location not captured yet'}</strong><span>Coordinates stay in your profile and are not sent to a lookup service.</span></div>
                        {!locating && <button type="button" className="text-action" onClick={captureCurrentLocation}>Try again</button>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="profile-input-grid location-address-fields">
                    <label className="profile-field-wide">Street address<input autoComplete="street-address" placeholder="House number and street" value={profileForm.address} onChange={(event) => setProfileForm({ ...profileForm, address: event.target.value })} /></label>
                    <label>City<input autoComplete="address-level2" value={profileForm.city} onChange={(event) => setProfileForm({ ...profileForm, city: event.target.value })} /></label>
                    <label>State<input autoComplete="address-level1" value={profileForm.state} onChange={(event) => setProfileForm({ ...profileForm, state: event.target.value })} /></label>
                    <label>Postal code<input autoComplete="postal-code" value={profileForm.postalCode} onChange={(event) => setProfileForm({ ...profileForm, postalCode: event.target.value })} /></label>
                  </div>
                )}
              </section>
              {error && <p className="owner-form-error" role="alert">{error}</p>}
              {message && <p className="success-message" role="status">{message}</p>}
              <button type="submit" className="accept-action" disabled={busy || locating}>{busy ? 'Saving…' : 'Save profile'}</button>
            </form>
          ) : (
            <div className="profile-contact-card">
              <div><User className="icon" /><span>{profile.user.fullName}</span></div>
              <div><Mail className="icon" /><span>{profile.user.email}</span></div>
              {profile.user.phone && <div><Phone className="icon" /><span>{profile.user.phone}</span></div>}
              {profile.addresses[0] && (
                <div>
                  <MapPin className="icon" />
                  <span>
                    {[
                      profile.addresses[0].address,
                      profile.addresses[0].city,
                      profile.addresses[0].state,
                      profile.addresses[0].postalCode,
                    ].filter(Boolean).join(', ') || (
                      profile.addresses[0].latitude !== null && profile.addresses[0].longitude !== null
                        ? `${profile.addresses[0].latitude.toFixed(5)}, ${profile.addresses[0].longitude.toFixed(5)}`
                        : 'No delivery location saved'
                    )}
                  </span>
                </div>
              )}
              {!profile.addresses[0] && <p className="profile-empty-location">Add a delivery location to make checkout easier.</p>}
            </div>
          )}
          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="owner-form-error" role="alert">{error}</p>}
          <button className="profile-sign-out-button" onClick={onSignOut}><LogOut className="icon" /> Sign out</button>
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
  cartError,
  onReviewsChanged,
  reviewsOnly = false,
}: {
  products: Product[]
  session: AccountSession
  onAddToCart: (product: Product, quantity: number) => boolean
  onToggleFavorite: (productId: number) => void
  favoriteIds: number[]
  cartError: string
  onReviewsChanged: () => void
  reviewsOnly?: boolean
}) {
  const navigate = useNavigate()
  const { id } = useParams()
  const product = products.find((item) => item.id === Number(id))
  const productId = product?.id
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
  const [addingError, setAddingError] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadReviews = async () => {
      if (!productId) return
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

  if (!product) {
    return (
      <div className="empty-state-card">
        <h2>Medicine not found</h2>
        <p>This medicine may no longer be available.</p>
        <button className="accept-action" onClick={() => navigate('/')}>Back to medicines</button>
      </div>
    )
  }
    const recommended = products
      .filter((item) => item.id !== product.id && item.category === product.category)
      .slice(0, 6)

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className={reviewsOnly ? 'screen details-screen reviews-only-screen' : 'screen details-screen'}>
      <header className="topbar detail-topbar">
        <BackButton fallback="/" />
        {reviewsOnly ? <h2>Medicine Reviews</h2> : null}
        <button type="button" className={favoriteIds.includes(product.id) ? 'icon-button light selected' : 'icon-button light'} aria-label={favoriteIds.includes(product.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => onToggleFavorite(product.id)}>
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
          </div>
          <div className="rating-badge">
            <Star className="star-icon" />
            {reviewCount ? averageRating.toFixed(1) : 'New'}{reviewCount > 0 && <small>{reviewCount}</small>}
          </div>
        </div>

        <div className="price-row">
          <strong>₹{product.price.toLocaleString('en-IN')}</strong>
          <div className="quantity-control">
            <button onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={quantity <= 1}>
              <Minus className="icon" />
            </button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity((value) => Math.min(product.stock, value + 1))} aria-label="Increase quantity" disabled={quantity >= product.stock}>
              <Plus className="icon" />
            </button>
          </div>
        </div>

        <div className="tablet-strip-wrap">
          <div className="tablet-strip-header">
            <span>Tablet strip</span>
            <span>{quantity} selected</span>
          </div>
          <div className="tablet-strip">
            {Array.from({ length: 10 }, (_, index) => {
              const active = index < quantity
              return (
                <motion.button
                  key={index}
                  type="button"
                  disabled={index >= product.stock}
                  aria-label={`Select quantity ${index + 1}`}
                  aria-pressed={quantity === index + 1}
                  onClick={() => setQuantity(index + 1)}
                  layout
                  initial={false}
                  animate={{
                    scale: active ? 1 : 0.95,
                    opacity: active ? 1 : 0.5,
                    background: active ? '#83B900' : '#f0f1f2',
                    color: active ? '#fff' : '#050505',
                  }}
                  transition={{ duration: 0.2 }}
                  className="tablet-pill"
                >
                  {index + 1}
                </motion.button>
              )
            })}
          </div>
        </div>

        <div className="description-block">
          <div className="section-header compact">
            <h3>Description</h3>
          </div>
          <p>{product.description || 'Product information has not been added yet.'}</p>
        </div>
        {cartError && <p className="owner-form-error" role="alert">{cartError}</p>}
        {addingError && <p className="owner-form-error" role="alert">{addingError}</p>}

        <div className="product-detail-actions">
        <button
          className="primary-cta secondary-cta"
          onClick={() => {
            if (onAddToCart(product, quantity)) navigate('/cart')
            else setAddingError('Your cart already has medicines from another pharmacy. Finish or clear that order before switching stores.')
          }}
        >
          <Plus className="icon" /> Add to cart
        </button>
        <button
          className="primary-cta"
          onClick={() => {
            if (onAddToCart(product, quantity)) navigate('/checkout')
            else setAddingError('Your cart already has medicines from another pharmacy. Finish or clear that order before switching stores.')
          }}
        >Buy now <ArrowUpRight className="icon" /></button>
        </div>
        <section className="product-review-section">
          <div className="product-review-product"><img src={product.image} alt="" /><div><strong>{product.name}</strong><span>{product.pharmacyName}</span></div><span className={canReview ? 'order-status-pill delivered' : 'order-status-pill pending'}>{canReview ? 'Delivered' : 'Not delivered'}</span></div>
          <header className="product-review-heading"><div><h3>Customer reviews</h3><p>{reviewCount ? `${averageRating.toFixed(1)} average · ${reviewCount} verified reviews` : 'Be the first to share a verified-purchase review.'}</p></div><button type="button" onClick={() => navigate(`/product/${product.id}/reviews`)}>See all</button></header>
          {reviewError && <p className="owner-form-error" role="alert">{reviewError}</p>}
          {reviewMessage && <p className="success-message" role="status">{reviewMessage}</p>}
          {canReview ? (
            <form className="product-review-form" onSubmit={submitReview}>
              <span>Rate your delivered medicine</span>
              <div className="review-star-picker">{[1, 2, 3, 4, 5].map((rating) => (
                <button type="button" key={rating} aria-label={`${rating} stars`} aria-pressed={reviewRating === rating} onClick={() => setReviewRating(rating)}><Star className="star-icon" /></button>
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
        {recommended.length > 0 && (
          <section className="recommended-products">
            <h3>Recommended for you</h3>
            <div className="recommended-product-row">{recommended.map((item) => (
              <button type="button" className="recommended-product-card" key={item.id} onClick={() => navigate(`/product/${item.id}`)}>
                <img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.pack} · ₹{item.price.toLocaleString('en-IN')}</small></span>
              </button>
            ))}</div>
          </section>
        )}
      </motion.div>
    </motion.div>
  )
}

function CheckoutPage({
  cart,
  cartError,
  session,
  subtotal,
  paymentMethod,
  setPaymentMethod,
  onClearCart,
  total,
}: {
  cart: CartItem[]
  cartError: string
  session: AccountSession
  subtotal: number
  paymentMethod: string
  setPaymentMethod: (method: string) => void
  onClearCart: () => void
  total: number
}) {
  const navigate = useNavigate()
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [addressLoading, setAddressLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(cartError)
  const deliveryCharge = subtotal > 0 ? 49 : 0
  const tax = subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0

  useEffect(() => {
    let cancelled = false
    const loadAddress = async () => {
      try {
        const response = await authenticatedApiFetch('/api/customer/profile', session.token)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load your delivery location.')
        const address = (result as CustomerProfile).addresses[0]
        const formatted = address
          ? [address.address, address.city, address.state, address.postalCode].filter(Boolean).join(', ') ||
            (address.latitude !== null && address.longitude !== null ? `GPS ${address.latitude}, ${address.longitude}` : '')
          : ''
        if (!cancelled) setDeliveryAddress(formatted)
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load your delivery location.')
      } finally {
        if (!cancelled) setAddressLoading(false)
      }
    }
    // Load the saved destination used by the order API.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadAddress()
    return () => { cancelled = true }
  }, [session.token])

  const placeOrder = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await authenticatedApiFetch('/api/customer/orders', session.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((item) => ({ medicineId: item.id, quantity: item.quantity })),
          paymentMethod,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not place your order.')
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
          <div><span className="meta-label">Phone</span><strong>{session.user.phone || 'Add a phone number in your profile'}</strong></div>
        </div>
        <div className="checkout-section-heading"><span className="checkout-section-icon"><MapPin className="icon" /></span><div><h3>Delivery location</h3><p>Use your saved GPS location or enter an address in your profile.</p></div></div>
        <div className="address-card">
          <div className="address-header">
            <h4>{addressLoading ? 'Loading saved location…' : 'Saved delivery address'}</h4>
            <button type="button" onClick={() => navigate('/profile')}>Edit</button>
          </div>
          <div className="address-body">
            <div className="address-meta"><span className="meta-label">Address</span><strong>{addressLoading ? 'Loading saved location…' : deliveryAddress || 'Add an address or GPS location in your profile'}</strong></div>
          </div>
        </div>
        <div className="checkout-section-heading"><span className="checkout-section-icon"><PackageCheck className="icon" /></span><div><h3>Order summary</h3><p>{cart.reduce((sum, item) => sum + item.quantity, 0)} medicine unit(s)</p></div></div>
        <div className="summary-row"><span>Subtotal</span><strong>₹{subtotal.toLocaleString('en-IN')}</strong></div>
        <div className="summary-row"><span>Delivery Charge</span><strong>₹{deliveryCharge}</strong></div>
        <div className="summary-row"><span>Tax</span><strong>₹{tax}</strong></div>
        <div className="summary-row total"><span>Total</span><strong>₹{total.toLocaleString('en-IN')}</strong></div>
        <div className="checkout-section-heading"><span className="checkout-section-icon"><ShoppingBag className="icon" /></span><div><h3>Payment method</h3><p>Choose how you would like to pay.</p></div></div>
        <div className="payment-stack">
          {['Cash on Delivery', 'UPI Payment'].map((option) => (
            <button
              key={option}
              className={paymentMethod === option ? 'payment-option selected' : 'payment-option'}
              onClick={() => setPaymentMethod(option)}
            >
              <span>{option}</span>
              {paymentMethod === option ? <Check className="icon" /> : <span className="dot" />}
            </button>
          ))}
        </div>
        {error && <p className="owner-form-error" role="alert">{error}</p>}
        <button className="primary-cta dark" disabled={saving || addressLoading || !deliveryAddress} onClick={() => void placeOrder()}>
          {saving ? 'Placing order…' : 'Place order'}
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
  const [role, setRole] = useState<AccountRole>(requestedRole === 'pharmacy_owner' ? 'pharmacy_owner' : 'customer')
  const [isSignUp, setIsSignUp] = useState(searchParams.get('mode') === 'signup')
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
        </div>

        <div className="auth-mode-switch" aria-label="Sign-in method">
          <button type="button" className={!isSignUp ? 'active' : ''} aria-pressed={!isSignUp} onClick={() => setMode(false)}>Sign in</button>
          <button type="button" className={isSignUp ? 'active' : ''} aria-pressed={isSignUp} onClick={() => setMode(true)}>Create account</button>
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
        <p className="auth-privacy-note">Your account opens only the {role === 'customer' ? 'customer' : 'pharmacy owner'} workspace.</p>
      </section>
    </main>
  )
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
    medicines: 'Medicines',
    delivery: 'Delivery',
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

          {(activeSection === 'orders' || activeSection === 'delivery') && <PharmacyOrdersScreen token={ownerSession.token} orderId={orderId} />}
          {activeSection === 'medicines' && <PharmacyMedicinesScreen onCatalogChange={onCatalogChange} token={ownerSession.token} />}
        </main>
      </div>
    </motion.div>
  )
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
            <div className="owner-order-items">{order.items.map((item) => <div key={`${order.id}-${item.medicineId}`}><span>{item.name} × {item.quantity}</span><strong>₹{item.lineTotal.toLocaleString('en-IN')}</strong></div>)}</div>
            <p className="customer-order-address"><MapPin className="icon" /> {order.deliveryAddress}</p>
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
      category: item.category,
      pack: item.pack,
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
    if (!form.name.trim() || !form.category.trim() || !form.pack.trim()) {
      setStepError('Add the medicine name, category, and pack size before saving.')
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
    const matchesSearch = !inventorySearch.trim() || `${item.name} ${item.genericName ?? ''} ${item.sku ?? ''} ${item.batchNumber ?? ''} ${item.manufacturer ?? ''}`.toLowerCase().includes(inventorySearch.trim().toLowerCase())
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
              <div className="medicine-editor-fields">
                <label className="medicine-field-wide">Medicine name<input autoFocus required placeholder="e.g. Paracetamol 500 mg" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                <label>Category<input required list="medicine-category-options" placeholder="Choose or type a category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /><datalist id="medicine-category-options">{categories.map((category) => <option key={category.name} value={category.name} />)}</datalist></label>
                <label>Pack size<input required placeholder="e.g. 10 tablets" value={form.pack} onChange={(event) => setForm({ ...form, pack: event.target.value })} /></label>
                <label>Sale price (₹)<input required type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
                <label>Stock quantity<input required type="number" min="0" step="1" placeholder="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
                <label>Low-stock alert<input required type="number" min="0" step="1" placeholder="0" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} /></label>
                <label>Expiry date<input type="date" value={form.expiry} onChange={(event) => setForm({ ...form, expiry: event.target.value })} /></label>
                <label>SKU / barcode<input placeholder="Optional" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
                <label>Generic name<input placeholder="Optional" value={form.genericName} onChange={(event) => setForm({ ...form, genericName: event.target.value })} /></label>
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
