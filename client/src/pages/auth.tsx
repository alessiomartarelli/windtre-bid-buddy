import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function Auth() {
  const { user, loading: isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding */}
      <div className="hidden lg:flex flex-col justify-between bg-[#1D2338] text-white p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop&q=80')] opacity-10 bg-cover bg-center" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1D2338] via-[#1D2338]/90 to-primary/20" />
        
        <div className="relative z-10">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center font-display font-bold text-2xl text-white shadow-lg shadow-orange-500/20 mb-6">
            W
          </div>
          <h1 className="font-display font-bold text-5xl mb-4 leading-tight">
            Welcome to <br/>
            <span className="text-primary">BidBuddy</span>
          </h1>
          <p className="text-gray-300 text-lg max-w-md">
            The premium auction platform for exclusive tech deals. Join thousands of winners today.
          </p>
        </div>

        <div className="relative z-10 text-sm text-gray-400">
          © 2024 WindTre Bid Buddy. All rights reserved.
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="flex items-center justify-center p-8 bg-gray-50">
        <Card className="w-full max-w-md border-none shadow-xl bg-white/80 backdrop-blur-md">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <div className="lg:hidden w-12 h-12 rounded-xl bg-primary flex items-center justify-center font-display font-bold text-2xl text-white shadow-lg shadow-orange-500/20 mx-auto mb-6">
                W
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign in to your account</h2>
              <p className="text-gray-500">
                Access your bids, watchlist, and account settings
              </p>
            </div>

            <div className="space-y-4">
              <Button 
                size="lg" 
                className="w-full h-12 text-base font-semibold bg-[#1D2338] hover:bg-[#1D2338]/90 shadow-lg shadow-blue-900/10"
                onClick={handleLogin}
              >
                Continue with Replit
              </Button>
              
              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-400">Trusted by 10k+ users</span>
                </div>
              </div>

              <div className="text-center text-xs text-gray-400">
                By continuing, you agree to our Terms of Service and Privacy Policy.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
