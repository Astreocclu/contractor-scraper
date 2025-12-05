import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, Users, Settings, Menu, X, AlertTriangle } from 'lucide-react'
import { Dashboard } from '@/views/Dashboard'
import { LeadTable } from '@/views/LeadTable'
import { ContractorDetailModal } from '@/views/ContractorDetail'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      onError: () => {
        toast.error('Failed to fetch data', {
          description: 'Please check if the backend is running on port 8002',
        })
      },
    },
  },
})

// Navigation items
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Lead Grid', icon: Users },
]

function AppContent() {
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedContractor, setSelectedContractor] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Handle contractor selection from table
  const handleSelectContractor = (contractor) => {
    setSelectedContractor(contractor)
  }

  // Close sidebar on view change (mobile)
  const handleNavClick = (id) => {
    setActiveView(id)
    setSidebarOpen(false)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden mr-2"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">CS</span>
            </div>
            <span className="font-semibold hidden sm:inline-block">
              Contractor Scraper
            </span>
          </div>
          <div className="flex-1" />
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={activeView === item.id ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveView(item.id)}
                className="gap-2"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
      </header>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden">
          <nav className="fixed inset-y-0 left-0 w-64 bg-background border-r p-4 pt-16">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={activeView === item.id ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2 mb-1"
                onClick={() => handleNavClick(item.id)}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="container py-6">
        {activeView === 'dashboard' && <Dashboard />}
        {activeView === 'leads' && (
          <LeadTable onSelectContractor={handleSelectContractor} />
        )}
      </main>

      {/* Contractor Detail Modal */}
      <ContractorDetailModal
        contractor={selectedContractor}
        open={!!selectedContractor}
        onOpenChange={(open) => !open && setSelectedContractor(null)}
      />

      {/* Toast notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'dark:bg-card dark:text-card-foreground dark:border-border',
        }}
      />
    </div>
  )
}

function App() {
  // Set dark mode by default
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}

export default App
