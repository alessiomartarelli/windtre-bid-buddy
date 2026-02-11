import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Gavel, 
  History, 
  Settings, 
  LogOut, 
  Menu,
  Bell,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/auctions", label: "Active Auctions", icon: Gavel },
    { href: "/my-bids", label: "My Bids", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const Sidebar = () => (
    <div className="flex h-full flex-col bg-[#1D2338] text-white">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center font-display font-bold text-xl text-white shadow-lg shadow-orange-500/20">
            W
          </div>
          <span className="font-display font-bold text-2xl tracking-tight">BidBuddy</span>
        </div>
        
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer
                  ${isActive 
                    ? "bg-primary text-white shadow-lg shadow-orange-500/20 font-medium translate-x-1" 
                    : "text-gray-400 hover:text-white hover:bg-white/5"}
                `}>
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6 border-t border-white/10">
        <div className="flex items-center gap-3 mb-4 px-2">
          <Avatar className="h-10 w-10 border-2 border-primary">
            <AvatarImage src={user?.avatarUrl || ""} />
            <AvatarFallback className="bg-white/10 text-white font-medium">
              {user?.username?.substring(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.username || "Guest"}</p>
            <p className="text-xs text-gray-400 truncate">{user?.email || "Sign in to bid"}</p>
          </div>
        </div>
        
        {user ? (
          <Button 
            variant="ghost" 
            className="w-full justify-start text-gray-400 hover:text-white hover:bg-white/5"
            onClick={() => logout()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        ) : (
          <Link href="/auth">
            <Button className="w-full bg-white/10 hover:bg-white/20 text-white border-none">
              Sign In
            </Button>
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-64 fixed inset-y-0 left-0 z-50">
        <Sidebar />
      </div>

      {/* Mobile Sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden fixed top-4 left-4 z-50 bg-white shadow-md">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 border-r-[#1D2338] w-64">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64">
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-end gap-4">
            <div className="relative hidden md:block w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search auctions..." 
                className="w-full pl-10 pr-4 py-2 rounded-full bg-gray-100 border-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all outline-none text-sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="relative text-gray-500 hover:text-primary hover:bg-orange-50">
                <Bell className="h-5 w-5" />
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
              </Button>
            </div>
          </div>
        </header>

        <main className="p-6 md:p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </main>
      </div>
    </div>
  );
}
