import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  BadgeAlert,
  Bell,
  BellRing,
  Camera,
  Check,
  Heart,
  Home,
  Minus,
  MoreHorizontal,
  Pill,
  Plus,
  Search,
  ShoppingBag,
  Star,
  Truck,
  User,
  WalletCards,
  X,
  ClipboardList,
  LogOut,
  Users,
  LayoutGrid,
  PackageCheck,
  ChevronRight,
  MapPin,
  Phone,
  Mail,
  CalendarDays,
  Package,
  CircleCheck,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'

type Product = {
  id: number
  name: string
  category: string
  pack: string
  price: number
  originalPrice?: number
  image: string
  rating?: number
  description: string
  badge?: string
}

type CartItem = Product & {
  quantity: number
}

type InventoryRecord = {
  id: number
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

type OwnerSession = {
  email: string
  token: string
}

type OwnerAuthStatus = {
  ownerConfigured: boolean
  canSetupOwner: boolean
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const apiUrl = (path: string) => `${API_BASE_URL}${path}`

function ownerApiFetch(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(apiUrl(path), {
    ...init,
    headers,
  })
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

const chartData = [
  { name: 'Mon', revenue: 4200 },
  { name: 'Tue', revenue: 5100 },
  { name: 'Wed', revenue: 4700 },
  { name: 'Thu', revenue: 6200 },
  { name: 'Fri', revenue: 6900 },
  { name: 'Sat', revenue: 8300 },
  { name: 'Sun', revenue: 7600 },
]

const metrics = [
  { label: 'Today\'s Revenue', value: '₹ 18,240', change: '+12.5%', icon: WalletCards },
  { label: 'Monthly Revenue', value: '₹ 2,48,260', change: '+8.2%', icon: ArrowDownUp },
  { label: 'Total Orders', value: '1,248', change: '+14.7%', icon: ClipboardList },
  { label: 'Pending Orders', value: '48', change: '-3.1%', icon: PackageCheck },
  { label: 'Delivered Orders', value: '910', change: '+9.8%', icon: Truck },
  { label: 'Total Customers', value: '3,840', change: '+6.4%', icon: Users },
  { label: 'Low Stock Items', value: '17', change: 'Needs review', icon: BadgeAlert },
]

const sidebarItems: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'Home', icon: LayoutGrid },
  { label: 'Orders', icon: ClipboardList },
  { label: 'Medicines', icon: Pill },
  { label: 'Delivery', icon: Truck },
]

const customerTabs = ['Home', 'Favorites', 'Orders', 'Profile']

const demoOrders = [
  {
    id: 'PP-2048',
    date: '16 Nov 2026',
    pharmacy: 'Greenleaf Pharmacy',
    total: 1599,
    status: 'Preparing',
    items: ['Biotin For Beauty', 'Vitamin C Plus'],
  },
  {
    id: 'PP-2037',
    date: '12 Nov 2026',
    pharmacy: 'Greenleaf Pharmacy',
    total: 399,
    status: 'Delivered',
    items: ['Cough Relief Syrup'],
  },
  {
    id: 'PP-2019',
    date: '08 Nov 2026',
    pharmacy: 'City Care Pharmacy',
    total: 260,
    status: 'Delivered',
    items: ['ORS Electrolyte'],
  },
]

function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [storeCategories, setStoreCategories] = useState(categories)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('Tablets')
  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery')
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])

  const refreshCatalog = async () => {
    try {
      const [medicinesResponse, categoriesResponse] = await Promise.all([
        fetch(apiUrl('/api/catalog/medicines')),
        fetch(apiUrl('/api/catalog/categories')),
      ])
      const [medicinesResult, categoriesResult] = await Promise.all([
        medicinesResponse.json(),
        categoriesResponse.json(),
      ])
      if (!medicinesResponse.ok) throw new Error(medicinesResult.error || 'Could not load the medicine catalog.')
      if (!categoriesResponse.ok) throw new Error(categoriesResult.error || 'Could not load medicine categories.')
      setProducts((medicinesResult as InventoryRecord[]).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        pack: item.pack,
        price: item.price,
        image: item.imageUrl || '/pharma-plus-icon.png',
        description: item.description || '',
      })))
      setStoreCategories((categoriesResult as Array<{ name: string }>).map(({ name }) => ({
        name,
        icon: categories.find((category) => category.name === name)?.icon ?? '💊',
      })))
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
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + quantity } : item,
        )
      }
      return [...current, { ...product, quantity }]
    })
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
          item.id === id ? { ...item, quantity: Math.max(1, item.quantity + adjustment) } : item,
        ),
    )
  }

  const total = subtotal + (subtotal > 0 ? 49 : 0) + (subtotal > 0 ? Math.round(subtotal * 0.05) : 0)

  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-frame">
          <ViewModeToggle />

          <Routes>
            <Route
              path="/"
              element={
                <CustomerHomePage
                  categories={storeCategories}
                  products={products}
                  selectedCategory={selectedCategory}
                  onSelectCategory={setSelectedCategory}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
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
                  onToggleFavorite={toggleFavorite}
                  emptyMessage="Products you save will appear here."
                />
              }
            />
            <Route path="/orders" element={<CustomerOrdersPage />} />
            <Route path="/profile" element={<CustomerProfilePage />} />
            <Route
              path="/product/:id"
              element={
                <ProductDetailPage
                  products={products}
                  onAddToCart={handleAddToCart}
                />
              }
            />
            <Route
              path="/checkout"
              element={
                <CheckoutPage
                  cart={cart}
                  subtotal={subtotal}
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  updateCartQuantity={updateCartQuantity}
                  orderPlaced={orderPlaced}
                  setOrderPlaced={setOrderPlaced}
                  total={total}
                />
              }
            />
            <Route path="/dashboard/:section?" element={<DashboardPage onCatalogChange={() => void refreshCatalog()} />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}

function ViewModeToggle() {
  const { pathname } = useLocation()
  const isPharmacy = pathname.startsWith('/dashboard')

  return (
    <div className="mode-toggle-row">
      <NavLink end to="/" className={!isPharmacy ? 'mode-pill active' : 'mode-pill'}>Customer view</NavLink>
      <NavLink to="/dashboard" className={isPharmacy ? 'mode-pill active' : 'mode-pill'}>Pharmacy dashboard</NavLink>
    </div>
  )
}

function CustomerHomePage({
  categories,
  products,
  selectedCategory,
  onSelectCategory,
  favoriteIds,
  onToggleFavorite,
  catalogError,
}: {
  categories: Array<{ name: string; icon: string }>
  products: Product[]
  selectedCategory: string
  onSelectCategory: (value: string) => void
  favoriteIds: number[]
  onToggleFavorite: (productId: number) => void
  catalogError: string
}) {
  const navigate = useNavigate()
  const [greeting] = useState(() => {
    const hour = new Date().getHours()
    return hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening'
  })
  const profileName = 'Arun Kumar'

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen customer-screen">
      <header className="topbar customer-topbar">
        <div className="profile-wrap">
          <img
            src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80"
            alt="Profile"
            className="profile-avatar"
          />
          <div>
            <small>{greeting}</small>
            <h2>{profileName}</h2>
          </div>
        </div>
        <button className="icon-button" aria-label="notifications">
          <Bell className="icon" />
        </button>
      </header>

      <section className="hero-copy">
        <h1>
          <span>Your Trusted</span>
          <span className="light">Online Pharmacy</span>
        </h1>
      </section>

      <div className="search-row">
        <div className="search-field">
          <Search className="search-icon" />
          <input type="text" placeholder="Search medicines..." />
        </div>
        <button className="search-action" aria-label="Search">
          <Camera className="icon" />
        </button>
      </div>

      <section className="section-block">
        <div className="section-header">
          <h3>Categories</h3>
          <button>See All</button>
        </div>
        <div className="pill-row horizontal-scroll">
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
        <div className="section-header">
          <h3>Best Products</h3>
          <span>{products.length} items</span>
        </div>
        {catalogError && <p className="owner-form-error" role="alert">{catalogError}</p>}
        <div className="product-row horizontal-scroll">
          {products.map((product) => (
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
                <small>{product.category}</small>
                <div className="price-row-card">
                  <strong>₹{product.price.toLocaleString('en-IN')}</strong>
                  <button className="mini-arrow" aria-label={`View ${product.name}`}>
                    <ArrowUpRight className="icon" />
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
          {products.length === 0 && !catalogError && <p className="empty-state-card compact-empty">No medicines are listed yet. The pharmacy owner can add products from the dashboard.</p>}
        </div>
      </section>

      <CustomerBottomNav />
    </motion.div>
  )
}

function CustomerBottomNav() {
  const navIcons = [Home, Heart, ShoppingBag, User]
  const navPaths = ['/', '/favorites', '/orders', '/profile']

  return (
    <nav className="bottom-nav" aria-label="Customer navigation">
      {customerTabs.map((tab, index) => {
        const Icon = navIcons[index]
        return (
          <NavLink
            key={tab}
            end={tab === 'Home'}
            to={navPaths[index]}
            className={({ isActive }) => (isActive ? 'bottom-nav-item active' : 'bottom-nav-item')}
          >
            <span className="nav-icon-wrap">
              <Icon className="icon" />
            </span>
            <span>{tab}</span>
          </NavLink>
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
  emptyMessage,
}: {
  title: string
  description: string
  products: Product[]
  onToggleFavorite: (productId: number) => void
  emptyMessage: string
}) {
  const navigate = useNavigate()

  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {products.length > 0 ? (
        <div className="customer-product-grid">
          {products.map((product) => (
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
                <p>{product.pack} · {product.category}</p>
                <strong>₹{product.price.toLocaleString('en-IN')}</strong>
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

function CustomerOrdersPage() {
  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>My Orders</h1>
        <p>Track deliveries and revisit your recent medicine orders.</p>
      </header>
      <div className="order-list">
        {demoOrders.map((order) => (
          <article className="customer-order-card" key={order.id}>
            <div className="order-card-top">
              <div>
                <span className="eyebrow">ORDER #{order.id}</span>
                <h2>{order.pharmacy}</h2>
              </div>
              <span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span>
            </div>
            <div className="order-card-meta">
              <span><CalendarDays className="icon" /> {order.date}</span>
              <strong>₹{order.total.toLocaleString('en-IN')}</strong>
            </div>
            <p className="order-items">{order.items.join(' · ')}</p>
            <div className="order-progress" aria-label={`Order status: ${order.status}`}>
              {['Placed', 'Accepted', 'Preparing', 'Delivered'].map((status, index) => {
                const activeIndex = order.status === 'Delivered' ? 3 : 2
                return <span key={status} className={index <= activeIndex ? 'complete' : ''} title={status} />
              })}
            </div>
            <div className="order-card-foot">
              <span><Package className="icon" /> {order.items.length} products</span>
              <button className="quiet-action">View details <ChevronRight className="icon" /></button>
            </div>
          </article>
        ))}
      </div>
      <CustomerBottomNav />
    </motion.main>
  )
}

function CustomerProfilePage() {
  const profileLinks = [
    { title: 'Personal information', subtitle: 'Name, email and phone', icon: User },
    { title: 'Saved addresses', subtitle: 'Home · Bengaluru', icon: MapPin },
    { title: 'Notifications', subtitle: 'Order updates and reminders', icon: Bell },
    { title: 'Privacy & security', subtitle: 'Password and account access', icon: CircleCheck },
  ]

  return (
    <motion.main className="screen customer-page-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header className="customer-page-header">
        <p className="eyebrow">PHARMA PLUS</p>
        <h1>My Profile</h1>
        <p>Manage your account and delivery preferences.</p>
      </header>
      <section className="profile-summary-card">
        <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80" alt="" />
        <div>
          <h2>Arun Kumar</h2>
          <p>Member since 2024</p>
        </div>
        <button className="round-action" aria-label="Edit profile"><ChevronRight className="icon" /></button>
      </section>
      <div className="profile-contact-card">
        <div><Phone className="icon" /><span>+91 98765 43210</span></div>
        <div><Mail className="icon" /><span>arun.kumar@example.com</span></div>
      </div>
      <section className="profile-links-card">
        {profileLinks.map(({ title, subtitle, icon: Icon }) => (
          <button className="profile-link-row" key={title}>
            <span className="profile-link-icon"><Icon className="icon" /></span>
            <span className="profile-link-copy"><strong>{title}</strong><small>{subtitle}</small></span>
            <ChevronRight className="icon profile-chevron" />
          </button>
        ))}
        <button className="profile-link-row logout-link">
          <span className="profile-link-icon"><LogOut className="icon" /></span>
          <span className="profile-link-copy"><strong>Log out</strong><small>Sign out of this device</small></span>
          <ChevronRight className="icon profile-chevron" />
        </button>
      </section>
      <CustomerBottomNav />
    </motion.main>
  )
}

function ProductDetailPage({
  products,
  onAddToCart,
}: {
  products: Product[]
  onAddToCart: (product: Product, quantity: number) => void
}) {
  const navigate = useNavigate()
  const { id } = useParams()
  const product = products.find((item) => item.id === Number(id))
  const [quantity, setQuantity] = useState(1)

  if (!product) {
    return (
      <div className="empty-state-card">
        <h2>Medicine not found</h2>
        <p>This medicine may no longer be available.</p>
        <button className="accept-action" onClick={() => navigate('/')}>Back to medicines</button>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen details-screen">
      <header className="topbar detail-topbar">
        <button className="icon-button light" onClick={() => navigate('/')}>
          <ArrowLeft className="icon" />
        </button>
        <button className="icon-button light" aria-label="Wishlist">
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
          </div>
          <div className="rating-badge">
            <Star className="star-icon" />
            {product.rating?.toFixed(1) ?? '4.9'}
          </div>
        </div>

        <div className="price-row">
          <strong>₹{product.price.toLocaleString('en-IN')}</strong>
          <div className="quantity-control">
            <button onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">
              <Minus className="icon" />
            </button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity">
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
                <motion.span
                  key={index}
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
                </motion.span>
              )
            })}
          </div>
        </div>

        <div className="description-block">
          <div className="section-header compact">
            <h3>Description</h3>
            <button>Read More...</button>
          </div>
          <p>{product.description}</p>
        </div>

        <button
          className="primary-cta"
          onClick={() => {
            onAddToCart(product, quantity)
            navigate('/checkout')
          }}
        >
          <Plus className="icon" /> Add Product
        </button>
      </motion.div>
    </motion.div>
  )
}

function CheckoutPage({
  cart,
  subtotal,
  paymentMethod,
  setPaymentMethod,
  updateCartQuantity,
  orderPlaced,
  setOrderPlaced,
  total,
}: {
  cart: CartItem[]
  subtotal: number
  paymentMethod: string
  setPaymentMethod: (method: string) => void
  updateCartQuantity: (id: number, adjustment: number) => void
  orderPlaced: boolean
  setOrderPlaced: (value: boolean) => void
  total: number
}) {
  const navigate = useNavigate()
  const deliveryCharge = subtotal > 0 ? 49 : 0
  const tax = subtotal > 0 ? Math.round(subtotal * 0.05) : 0

  if (orderPlaced) {
    return (
      <div className="confirmation-panel">
        <div className="success-icon-wrap">
          <Check className="check-icon" />
        </div>
        <h2>Your order has been placed successfully!</h2>
        <p>Kindly wait for pharmacy confirmation.</p>
        <div className="confirmation-card">
          <div className="meta-row"><span>Order ID</span><strong>#PH-2034</strong></div>
          <div className="meta-row"><span>Pharmacy</span><strong>Pharma Plus Care</strong></div>
          <div className="meta-row"><span>Order summary</span><strong>{cart.length} medicines • ₹{total.toLocaleString('en-IN')}</strong></div>
        </div>
        <button className="primary-cta dark" onClick={() => navigate('/')}>
          Track Order
        </button>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen checkout-screen">
      <header className="topbar checkout-topbar">
        <button className="icon-button light" onClick={() => navigate('/')}>
          <ArrowLeft className="icon" />
        </button>
        <h2>Checkout</h2>
        <button className="icon-button light" aria-label="More options">
          <MoreHorizontal className="icon" />
        </button>
      </header>

      <div className="items-stack">
        {cart.map((item) => (
          <div key={item.id} className="cart-item-card">
            <img src={item.image} alt={item.name} />
            <div className="cart-copy">
              <h4>{item.name}</h4>
              <small>{item.pack}</small>
              <strong>₹{(item.price * item.quantity).toLocaleString('en-IN')}</strong>
            </div>
            <div className="cart-actions">
              <button
                className="delete-btn"
                aria-label={`Remove ${item.name}`}
                onClick={() => updateCartQuantity(item.id, -item.quantity)}
              >
                <X className="icon" />
              </button>
              <div className="mini-quantity">
                <button onClick={() => updateCartQuantity(item.id, -1)} aria-label={`Decrease quantity for ${item.name}`}>
                  <Minus className="icon" />
                </button>
                <span>{item.quantity}</span>
                <button onClick={() => updateCartQuantity(item.id, 1)} aria-label={`Increase quantity for ${item.name}`}>
                  <Plus className="icon" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="add-product-button" onClick={() => navigate('/')}>
        <Plus className="icon" /> Add Product
      </button>

      <div className="cart-summary-card">
        <div className="summary-row"><span>Subtotal</span><strong>₹{subtotal.toLocaleString('en-IN')}</strong></div>
        <div className="summary-row"><span>Discount</span><strong>−₹0</strong></div>
        <div className="summary-row"><span>Delivery Charge</span><strong>₹{deliveryCharge}</strong></div>
        <div className="summary-row"><span>Tax</span><strong>₹{tax}</strong></div>
        <div className="summary-row total"><span>Total</span><strong>₹{total.toLocaleString('en-IN')}</strong></div>
        <div className="voucher-row">
          <div>
            <Plus className="icon small" />
            <span>Use voucher</span>
          </div>
          <Plus className="icon small" />
        </div>
        <div className="address-card">
          <div className="address-header">
            <h4>Confirm Delivery Details</h4>
            <button>Confirm Details</button>
          </div>
          <div className="address-body">
            <div className="address-meta">
              <span className="meta-label">Customer</span>
              <strong>Arun Kumar</strong>
            </div>
            <div className="address-meta">
              <span className="meta-label">Phone</span>
              <strong>+91 98765 43210</strong>
            </div>
            <div className="address-meta">
              <span className="meta-label">Address</span>
              <strong>45, Green Park Road, Bengaluru</strong>
            </div>
          </div>
        </div>
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
        <button className="primary-cta dark" onClick={() => setOrderPlaced(true)}>
          Place Order
        </button>
      </div>
    </motion.div>
  )
}

function OwnerAccessPage({
  status,
  error: connectionError,
  onAuthenticated,
}: {
  status: OwnerAuthStatus | null
  error: string
  onAuthenticated: (session: OwnerSession) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [requestError, setRequestError] = useState('')
  const [busy, setBusy] = useState(false)
  const isSetup = status?.ownerConfigured === false

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSetup && password !== confirmation) {
      setRequestError('The passwords do not match.')
      return
    }
    setBusy(true)
    setRequestError('')
    try {
      const response = await fetch(apiUrl(isSetup ? '/api/auth/setup' : '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not sign in.')
      const session = result as OwnerSession
      localStorage.setItem('pharma-plus-owner-token', session.token)
      onAuthenticated(session)
    } catch (requestError) {
      setRequestError(requestError instanceof Error ? requestError.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen owner-auth-screen">
      <section className="owner-auth-card">
        <div className="brand-mark">P+</div>
        <p className="eyebrow">PHARMA PLUS OWNER</p>
        <h1>{isSetup ? 'Set up owner access' : 'Owner sign in'}</h1>
        <p>{isSetup ? 'Create the first owner account from this Mac. Use a unique password with at least 12 characters.' : 'Sign in to manage your pharmacy inventory.'}</p>
        {connectionError && <p className="owner-form-error" role="alert">{connectionError}</p>}
        {status?.ownerConfigured === false && !status.canSetupOwner ? (
          <p className="owner-form-error" role="alert">Create the first owner account on the Mac before signing in from this phone.</p>
        ) : status ? (
          <form onSubmit={submit} className="owner-auth-form">
            <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete={isSetup ? 'new-password' : 'current-password'} minLength={isSetup ? 12 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {isSetup && <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
            {requestError && <p className="owner-form-error" role="alert">{requestError}</p>}
            <button type="submit" className="accept-action" disabled={busy}>{busy ? 'Please wait…' : isSetup ? 'Create owner account' : 'Sign in'}</button>
          </form>
        ) : null}
      </section>
    </main>
  )
}

function DashboardPage({ onCatalogChange }: { onCatalogChange: () => void }) {
  const { section } = useParams()
  const activeSection = section ?? 'home'
  const [authStatus, setAuthStatus] = useState<OwnerAuthStatus | null>(null)
  const [ownerSession, setOwnerSession] = useState<OwnerSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const sectionTitles: Record<string, string> = {
    home: 'Good Morning, Arun',
    orders: 'Orders',
    medicines: 'Medicines',
    delivery: 'Delivery',
  }

  useEffect(() => {
    let cancelled = false
    const checkOwnerAccess = async () => {
      try {
        const statusResponse = await fetch(apiUrl('/api/auth/status'))
        const status = await statusResponse.json()
        if (!statusResponse.ok) throw new Error(status.error || 'Could not check owner access.')
        if (cancelled) return
        setAuthStatus(status as OwnerAuthStatus)

        const token = localStorage.getItem('pharma-plus-owner-token')
        if (token) {
          const sessionResponse = await ownerApiFetch('/api/auth/session', token)
          if (sessionResponse.ok) {
            const session = await sessionResponse.json()
            if (!cancelled) setOwnerSession({ token, email: session.email })
          } else {
            localStorage.removeItem('pharma-plus-owner-token')
          }
        }
      } catch (requestError) {
        if (!cancelled) setAuthError(requestError instanceof Error ? requestError.message : 'Could not check owner access.')
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }
    // Load the owner session from the authentication API.
    // oxlint-disable-next-line react/set-state-in-effect
    void checkOwnerAccess()
    return () => {
      cancelled = true
    }
  }, [])

  const logout = async () => {
    if (!ownerSession) return
    try {
      const response = await ownerApiFetch('/api/auth/logout', ownerSession.token, { method: 'POST' })
      if (!response.ok) throw new Error('The server could not end the owner session.')
    } catch (requestError) {
      setAuthError(requestError instanceof Error ? requestError.message : 'Could not end the owner session.')
    } finally {
      localStorage.removeItem('pharma-plus-owner-token')
      setOwnerSession(null)
    }
  }

  if (!authReady) {
    return <main className="screen owner-auth-screen"><p>Connecting to owner access…</p></main>
  }
  if (!ownerSession) {
    return (
      <OwnerAccessPage
        status={authStatus}
        error={authError}
        onAuthenticated={(session) => setOwnerSession(session)}
      />
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="screen dashboard-screen">
      <div className="dashboard-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark">P+</div>
            <div>
              <span className="brand-label">Pharma Plus</span>
              <strong>Owner Dashboard</strong>
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
              <h2>{sectionTitles[activeSection] ?? 'Pharmacy'}</h2>
              <small>{activeSection === 'home' ? 'Here’s what’s happening at your pharmacy today.' : `Manage your pharmacy ${activeSection} at a glance.`}</small>
            </div>
            <div className="header-actions">
              <button className="inline-date">Today · 15 Nov</button>
              <button className="icon-button light"><BellRing className="icon" /></button>
              <span className="owner-email">{ownerSession.email}</span>
              <button className="quiet-action owner-logout" onClick={() => void logout()}><LogOut className="icon" /> Sign out</button>
            </div>
          </header>

          {activeSection === 'home' && (
            <>
          <section className="metric-grid">
            {metrics.map(({ label, value, change, icon: Icon }) => (
              <div key={label} className="metric-card">
                <div className="metric-head">
                  <span className="metric-icon"><Icon className="icon" /></span>
                  <span>{label}</span>
                </div>
                <strong>{value}</strong>
                <small>{change}</small>
              </div>
            ))}
          </section>

          <div className="dashboard-section two-columns">
            <div className="panel chart-panel">
              <div className="panel-head">
                <h3>Revenue Overview</h3>
                <div className="segmented-control">
                  <button className="active">Daily</button>
                  <button>Monthly</button>
                  <button>Yearly</button>
                </div>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#83B900" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#83B900" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#E5E9F0" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tickSize={10} />
                    <YAxis axisLine={false} tickLine={false} width={40} />
                    <Tooltip />
                    <Area type="monotone" dataKey="revenue" stroke="#83B900" strokeWidth={3} fill="url(#revenueFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Best-Selling Medicines</h3>
                <button>View all</button>
              </div>
              <div className="sell-list">
                {[
                  { name: 'Biotin For Beauty', category: 'Hair & Skin', qty: 87, revenue: '₹ 84,960', stock: 124 },
                  { name: 'Vitamin C Plus', category: 'Vitamins', qty: 61, revenue: '₹ 57,440', stock: 96 },
                  { name: 'Cough Relief Syrup', category: 'Syrup', qty: 49, revenue: '₹ 41,280', stock: 87 },
                ].map((item) => (
                  <div key={item.name} className="selling-item">
                    <div className="selling-icon">💊</div>
                    <div className="selling-meta">
                      <strong>{item.name}</strong>
                      <span>{item.category}</span>
                    </div>
                    <div className="selling-values">
                      <span>{item.qty} sold</span>
                      <strong>{item.revenue}</strong>
                      <small>{item.stock} in stock</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dashboard-section lower-grid">
            <div className="panel">
              <div className="panel-head">
                <h3>Recent Orders</h3>
                <button>Manage</button>
              </div>
              {[
                { id: '#PH-2048', customer: 'Arun Kumar', total: '₹ 1,599', status: 'Accepted' },
                { id: '#PH-2050', customer: 'Nisha Roy', total: '₹ 2,430', status: 'Preparing' },
                { id: '#PH-2056', customer: 'Ravi Sen', total: '₹ 980', status: 'Delivered' },
              ].map((order) => (
                <div key={order.id} className="list-row">
                  <div>
                    <strong>{order.id}</strong>
                    <span>{order.customer}</span>
                  </div>
                  <span>{order.total}</span>
                  <span className="status-pill">{order.status}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Low Stock Alerts</h3>
                <button>Review</button>
              </div>
              {[
                { name: 'Paracetamol', count: '8 packs left', risk: 'Low' },
                { name: 'Cough Syrup', count: '6 bottles left', risk: 'Critical' },
                { name: 'Thermometer', count: '3 units left', risk: 'Low' },
              ].map((alert) => (
                <div key={alert.name} className="list-row alert-row">
                  <div>
                    <strong>{alert.name}</strong>
                    <span>{alert.count}</span>
                  </div>
                  <span className={alert.risk === 'Critical' ? 'danger-tag' : 'warning-tag'}>{alert.risk}</span>
                </div>
              ))}
            </div>
          </div>
            </>
          )}

          {activeSection === 'orders' && <PharmacyOrdersScreen />}
          {activeSection === 'medicines' && <PharmacyMedicinesScreen onCatalogChange={onCatalogChange} token={ownerSession.token} />}
          {activeSection === 'delivery' && <PharmacyDeliveryScreen />}
        </main>
      </div>
    </motion.div>
  )
}

function PharmacyOrdersScreen() {
  const [orders, setOrders] = useState([
    { id: 'PH-2048', customer: 'Arun Kumar', phone: '+91 98765 43210', address: '45 Green Park Road, Bengaluru', items: 'Biotin For Beauty, Vitamin C Plus', total: 1599, status: 'Pending' },
    { id: 'PH-2047', customer: 'Nisha Roy', phone: '+91 98765 12034', address: '12 Lake View, Bengaluru', items: 'Cough Relief Syrup', total: 399, status: 'Preparing' },
    { id: 'PH-2046', customer: 'Ravi Sen', phone: '+91 98765 09341', address: '8 Indiranagar Main Road, Bengaluru', items: 'ORS Electrolyte × 2', total: 569, status: 'Delivered' },
  ])
  const [filter, setFilter] = useState('All')
  const filters = ['All', 'Pending', 'Preparing', 'Delivered']
  const visibleOrders = orders.filter((order) => filter === 'All' || order.status === filter)

  const updateOrder = (id: string, status: string) => {
    setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order))
  }

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Order management</h3><p>Review and update today’s customer orders.</p></div>
        <span className="count-badge">{orders.filter((order) => order.status === 'Pending').length} pending</span>
      </div>
      <div className="filter-pills">
        {filters.map((item) => (
          <button key={item} className={filter === item ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>
      <div className="pharmacy-card-list">
        {visibleOrders.map((order) => (
          <article className="pharmacy-data-card" key={order.id}>
            <div className="data-card-heading">
              <div><span className="eyebrow">ORDER #{order.id}</span><h3>{order.customer}</h3></div>
              <span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span>
            </div>
            <div className="pharmacy-data-line"><Phone className="icon" /><span>{order.phone}</span></div>
            <div className="pharmacy-data-line"><MapPin className="icon" /><span>{order.address}</span></div>
            <div className="pharmacy-order-items">{order.items}</div>
            <div className="data-card-footer">
              <strong>₹{order.total.toLocaleString('en-IN')}</strong>
              {order.status === 'Pending' ? (
                <div className="inline-actions">
                  <button className="accept-action" onClick={() => updateOrder(order.id, 'Accepted')}>Accept</button>
                  <button className="decline-action" onClick={() => {
                    const reason = window.prompt('Enter a reason for declining this order')
                    if (reason?.trim()) updateOrder(order.id, 'Declined')
                  }}>Decline</button>
                </div>
              ) : order.status === 'Accepted' ? (
                <button className="accept-action" onClick={() => updateOrder(order.id, 'Preparing')}>Start preparing</button>
              ) : null}
            </div>
          </article>
        ))}
        {visibleOrders.length === 0 && <div className="empty-state-card compact-empty">No orders in this filter.</div>}
      </div>
    </section>
  )
}

function PharmacyMedicinesScreen({ onCatalogChange, token }: { onCatalogChange: () => void; token: string }) {
  const [inventory, setInventory] = useState<InventoryRecord[]>([])
  const [form, setForm] = useState<MedicineForm | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadInventory = useCallback(async () => {
    try {
      const response = await ownerApiFetch('/api/medicines', token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load medicines.')
      setInventory(result as InventoryRecord[])
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
      setForm(null)
      setEditingId(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save medicine.')
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

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Inventory</h3><p>Keep product availability and stock up to date.</p></div>
        <button
          className="accept-action"
          onClick={() => {
            setEditingId(null)
            setForm(emptyMedicineForm())
          }}
        >
          <Plus className="icon" /> Add medicine
        </button>
      </div>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      {form && (
        <form className="owner-medicine-form" onSubmit={saveMedicine}>
          <div className="panel-head">
            <h3>{editingId ? 'Edit medicine details' : 'Add a medicine'}</h3>
            <button type="button" className="quiet-action" onClick={() => setForm(null)}>Cancel</button>
          </div>
          <div className="owner-form-grid">
            <label>Medicine name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Category<input required list="medicine-category-options" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
            <datalist id="medicine-category-options">{categories.map((category) => <option key={category.name} value={category.name} />)}</datalist>
            <label>Pack size<input required placeholder="e.g. 10 tablets" value={form.pack} onChange={(event) => setForm({ ...form, pack: event.target.value })} /></label>
            <label>Sale price (₹)<input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
            <label>Stock quantity<input required type="number" min="0" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
            <label>Low-stock alert at<input required type="number" min="0" step="1" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} /></label>
            <label>Expiry date<input type="date" value={form.expiry} onChange={(event) => setForm({ ...form, expiry: event.target.value })} /></label>
            <label>SKU / barcode<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
            <label>Generic name<input value={form.genericName} onChange={(event) => setForm({ ...form, genericName: event.target.value })} /></label>
            <label>Manufacturer<input value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} /></label>
            <label>Batch number<input value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} /></label>
            <label>GST rate (%)<input type="number" min="0" max="100" step="0.01" value={form.gstRate} onChange={(event) => setForm({ ...form, gstRate: event.target.value })} /></label>
            <label>HSN code<input value={form.hsnCode} onChange={(event) => setForm({ ...form, hsnCode: event.target.value })} /></label>
            <label>Image URL<input type="url" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></label>
            <label className="owner-checkbox-field">
              <input type="checkbox" checked={form.prescriptionRequired} onChange={(event) => setForm({ ...form, prescriptionRequired: event.target.checked })} />
              Prescription required
            </label>
            <label className="owner-form-wide">Description<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          </div>
          <div className="owner-form-actions">
            <button type="button" className="quiet-action" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="accept-action" disabled={saving}>{saving ? 'Saving…' : 'Save medicine'}</button>
          </div>
        </form>
      )}
      <div className="inventory-summary">
        <div><span>Products</span><strong>{inventory.length}</strong></div>
        <div><span>Low stock</span><strong>{inventory.filter((item) => item.stock > 0 && item.stock <= item.reorderLevel).length}</strong></div>
        <div><span>Out of stock</span><strong>{inventory.filter((item) => item.stock === 0).length}</strong></div>
      </div>
      <div className="pharmacy-card-list">
        {inventory.map((item) => (
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
              <div className="inventory-controls">
                <div className="mini-quantity">
                  <button aria-label={`Decrease ${item.name} stock`} onClick={() => void changeStock(item, -1)}><Minus className="icon" /></button>
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
      </div>
    </section>
  )
}

function PharmacyDeliveryScreen() {
  const [deliveries, setDeliveries] = useState([
    { id: 'PH-2048', customer: 'Arun Kumar', address: 'Green Park Road, Bengaluru', items: '2 products', status: 'Preparing' },
    { id: 'PH-2047', customer: 'Nisha Roy', address: 'Lake View, Bengaluru', items: '1 product', status: 'Ready for pickup' },
    { id: 'PH-2045', customer: 'Meera Das', address: 'Jayanagar 4th Block, Bengaluru', items: '3 products', status: 'Out for delivery' },
  ])
  const nextStatus: Record<string, string> = {
    Preparing: 'Ready for pickup',
    'Ready for pickup': 'Out for delivery',
    'Out for delivery': 'Delivered',
  }

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Delivery queue</h3><p>Move each order through its fulfillment steps.</p></div>
        <span className="count-badge">{deliveries.filter((item) => item.status !== 'Delivered').length} active</span>
      </div>
      <div className="delivery-summary-card">
        <div className="delivery-summary-icon"><Truck className="icon" /></div>
        <div><strong>Today’s fulfillment</strong><span>Pickup and local delivery in progress</span></div>
      </div>
      <div className="pharmacy-card-list">
        {deliveries.map((delivery) => (
          <article className="pharmacy-data-card" key={delivery.id}>
            <div className="data-card-heading">
              <div><span className="eyebrow">ORDER #{delivery.id}</span><h3>{delivery.customer}</h3></div>
              <span className={`order-status ${delivery.status === 'Delivered' ? 'delivered' : 'preparing'}`}>{delivery.status}</span>
            </div>
            <div className="pharmacy-data-line"><MapPin className="icon" /><span>{delivery.address}</span></div>
            <div className="pharmacy-data-line"><Package className="icon" /><span>{delivery.items} · Cash on delivery</span></div>
            <div className="delivery-steps">
              {['Preparing', 'Ready for pickup', 'Out for delivery', 'Delivered'].map((status) => (
                <span key={status} className={status === delivery.status ? 'current' : ''} />
              ))}
            </div>
            {delivery.status !== 'Delivered' && (
              <button
                className="accept-action full-action"
                onClick={() => setDeliveries((current) => current.map((item) =>
                  item.id === delivery.id ? { ...item, status: nextStatus[item.status] ?? item.status } : item,
                ))}
              >
                Mark {nextStatus[delivery.status]}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export default App
