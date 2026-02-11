import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Product } from "@shared/schema";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Timer, TrendingUp, Tag } from "lucide-react";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const timeLeft = new Date(product.endsAt) > new Date() 
    ? formatDistanceToNow(new Date(product.endsAt), { addSuffix: true })
    : "Ended";
  
  const isEndingSoon = new Date(product.endsAt).getTime() - new Date().getTime() < 24 * 60 * 60 * 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      transition={{ duration: 0.3 }}
    >
      <Link href={`/product/${product.id}`}>
        <Card className="group overflow-hidden border-none shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer h-full flex flex-col bg-white">
          <div className="relative aspect-[4/3] overflow-hidden">
            <img 
              src={product.imageUrl} 
              alt={product.title}
              className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
            />
            <div className="absolute top-3 right-3 flex flex-col gap-2">
              <Badge variant="secondary" className="backdrop-blur-md bg-white/90 shadow-sm font-semibold text-xs uppercase tracking-wide">
                {isEndingSoon && <Timer className="w-3 h-3 mr-1 text-orange-600" />}
                {timeLeft}
              </Badge>
            </div>
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          <CardContent className="p-5 flex-1">
            <h3 className="font-display font-bold text-lg text-gray-900 group-hover:text-primary transition-colors line-clamp-1 mb-2">
              {product.title}
            </h3>
            <p className="text-sm text-gray-500 line-clamp-2 mb-4">
              {product.description}
            </p>
            
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-primary" />
                <span>Start: €{(product.startPrice / 100).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="p-5 pt-0 mt-auto border-t border-gray-50 bg-gray-50/50">
            <div className="w-full flex items-center justify-between pt-4">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Current Bid</span>
                <span className="font-display font-bold text-xl text-primary flex items-center gap-1">
                  €{(product.currentPrice / 100).toFixed(2)}
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <Button size="sm" className="rounded-full px-6 font-semibold shadow-md shadow-orange-500/20 group-hover:bg-orange-600">
                Bid Now
              </Button>
            </div>
          </CardFooter>
        </Card>
      </Link>
    </motion.div>
  );
}
