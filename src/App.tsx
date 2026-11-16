import { useMemo, useState } from 'react'
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
  CircleUserRound,
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

const products: Product[] = [
  {
    id: 1,
    name: 'Biotin For Beauty',
    category: 'Hair & Skin',
    pack: '60 Capsules',
    price: 1499,
    originalPrice: 1899,
    image: '/products/biotin.svg',
    rating: 4.9,
    description:
      'Biotin support for healthy hair, skin and nail vitality. Crafted with essential nutrients to help sustain energy, strength and beauty from within.',
    badge: '12% OFF',
  },
  {
    id: 2,
    name: 'Cough Relief Syrup',
    category: 'Syrup',
    pack: '200 ml',
    price: 399,
    image: '/products/syrup.svg',
    rating: 4.7,
    description:
      'Soothing dual-action syrup formulated to relieve cough and throat irritation with a smooth, non-drowsy profile for everyday comfort.',
  },
  {
    id: 3,
    name: 'Vitamin C Plus',
    category: 'Vitamins',
    pack: '30 Tablets',
    price: 699,
    image: '/products/vitamin-c.svg',
    rating: 4.8,
    description:
      'A daily immunity-support blend with vitamin C and zinc to help protect, recharge and restore wellness for active lifestyles.',
    badge: 'New',
  },
  {
    id: 4,
    name: 'ORS Electrolyte',
    category: 'Hydration',
    pack: '20 sachets',
    price: 260,
    image: '/products/ors.svg',
    rating: 4.6,
    description:
      'Balanced rehydration support with essential electrolytes for recovery after exertion, illness or travel-related dehydration.',
  },
]

const initialCart: CartItem[] = [
  { ...products[0], quantity: 1 },
  { ...products[2], quantity: 1 },
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
  const [cart, setCart] = useState<CartItem[]>(initialCart)
  const [selectedCategory, setSelectedCategory] = useState('Tablets')
  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery')
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<number[]>([1, 3])

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
                  categories={categories}
                  products={products}
                  selectedCategory={selectedCategory}
                  onSelectCategory={setSelectedCategory}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
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
            <Route path="/dashboard/:section?" element={<DashboardPage />} />
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
}: {
  categories: Array<{ name: string; icon: string }>
  products: Product[]
  selectedCategory: string
  onSelectCategory: (value: string) => void
  favoriteIds: number[]
  onToggleFavorite: (productId: number) => void
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
          <button>See All</button>
        </div>
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
  const product = products.find((item) => item.id === Number(id)) ?? products[0]
  const [quantity, setQuantity] = useState(1)

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

function DashboardPage() {
  const { section } = useParams()
  const activeSection = section ?? 'home'
  const sectionTitles: Record<string, string> = {
    home: 'Good Morning, Arun',
    orders: 'Orders',
    medicines: 'Medicines',
    delivery: 'Delivery',
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
              <div className="mini-profile"><CircleUserRound className="icon" /></div>
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
          {activeSection === 'medicines' && <PharmacyMedicinesScreen />}
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

function PharmacyMedicinesScreen() {
  const [inventory, setInventory] = useState([
    { id: 1, name: 'Biotin For Beauty', category: 'Capsules · 60 count', price: 1499, stock: 24, expiry: 'Aug 2027', available: true },
    { id: 2, name: 'Cough Relief Syrup', category: 'Syrup · 200 ml', price: 399, stock: 8, expiry: 'Jan 2027', available: true },
    { id: 3, name: 'Vitamin C Plus', category: 'Tablets · 30 count', price: 699, stock: 0, expiry: 'Mar 2028', available: false },
  ])

  const changeStock = (id: number, amount: number) => {
    setInventory((current) => current.map((item) =>
      item.id === id ? { ...item, stock: Math.max(0, item.stock + amount), available: item.stock + amount > 0 } : item,
    ))
  }

  const addItem = () => {
    const name = window.prompt('Name of medicine to add')
    if (!name?.trim()) return
    setInventory((current) => [
      ...current,
      { id: Date.now(), name: name.trim(), category: 'New product · Pack size not set', price: 0, stock: 0, expiry: 'Add expiry', available: false },
    ])
  }

  return (
    <section className="pharmacy-page-content">
      <div className="pharmacy-page-heading">
        <div><h3>Inventory</h3><p>Keep product availability and stock up to date.</p></div>
        <button className="accept-action" onClick={addItem}><Plus className="icon" /> Add medicine</button>
      </div>
      <div className="inventory-summary">
        <div><span>Products</span><strong>{inventory.length}</strong></div>
        <div><span>Low stock</span><strong>{inventory.filter((item) => item.stock > 0 && item.stock < 10).length}</strong></div>
        <div><span>Out of stock</span><strong>{inventory.filter((item) => item.stock === 0).length}</strong></div>
      </div>
      <div className="pharmacy-card-list">
        {inventory.map((item) => (
          <article className="pharmacy-data-card inventory-card" key={item.id}>
            <div className="inventory-product-icon"><Pill className="icon" /></div>
            <div className="inventory-main">
              <div className="data-card-heading">
                <div><h3>{item.name}</h3><p>{item.category}</p></div>
                <span className={item.stock === 0 ? 'danger-tag' : item.stock < 10 ? 'warning-tag' : 'status-pill'}>
                  {item.stock === 0 ? 'Out of stock' : item.stock < 10 ? 'Low stock' : 'In stock'}
                </span>
              </div>
              <div className="inventory-details">
                <span>₹{item.price.toLocaleString('en-IN')}</span><span>{item.stock} units</span><span>Exp. {item.expiry}</span>
              </div>
              <div className="inventory-controls">
                <div className="mini-quantity">
                  <button aria-label={`Decrease ${item.name} stock`} onClick={() => changeStock(item.id, -1)}><Minus className="icon" /></button>
                  <span>{item.stock}</span>
                  <button aria-label={`Increase ${item.name} stock`} onClick={() => changeStock(item.id, 1)}><Plus className="icon" /></button>
                </div>
                <span className="availability-label"><CircleCheck className="icon" /> {item.available ? 'Available' : 'Unavailable'}</span>
              </div>
            </div>
          </article>
        ))}
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
