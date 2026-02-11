import { useProducts } from "@/hooks/use-products";
import { Layout } from "@/components/layout";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRight, TrendingUp, Sparkles, Trophy } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: products, isLoading } = useProducts();

  return (
    <Layout>
      <div className="space-y-10">
        {/* Hero Section */}
        <section className="relative rounded-3xl overflow-hidden bg-[#1D2338] text-white p-8 md:p-12 shadow-2xl">
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80')] opacity-10 bg-cover bg-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1D2338] via-[#1D2338]/90 to-transparent" />
          
          <div className="relative z-10 max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-primary text-sm font-medium border border-white/10 backdrop-blur-sm">
              <Sparkles className="w-4 h-4" />
              <span>Premium Auctions Live Now</span>
            </div>
            
            <h1 className="font-display font-bold text-4xl md:text-5xl lg:text-6xl leading-tight">
              Discover Exclusive <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-orange-400">Tech Deals</span>
            </h1>
            
            <p className="text-lg text-gray-300 max-w-lg">
              Bid on premium electronics, smartphones, and accessories starting at €1. Join the community of smart winners today.
            </p>
            
            <div className="flex flex-wrap gap-4 pt-2">
              <Button size="lg" className="rounded-full px-8 text-base font-semibold shadow-lg shadow-orange-500/25">
                Start Bidding
              </Button>
              <Button variant="outline" size="lg" className="rounded-full px-8 text-base font-semibold border-white/20 text-white hover:bg-white/10 hover:text-white">
                How It Works
              </Button>
            </div>
          </div>
        </section>

        {/* Featured Categories */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display font-bold text-2xl text-gray-900">Trending Now</h2>
            <Link href="/auctions" className="text-primary hover:text-orange-600 font-medium flex items-center gap-1 transition-colors">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-4">
                  <Skeleton className="h-64 w-full rounded-xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products?.slice(0, 8).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
          
          {!isLoading && products?.length === 0 && (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                <Trophy className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">No active auctions</h3>
              <p className="text-gray-500 mt-1">Check back later for new deals!</p>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
