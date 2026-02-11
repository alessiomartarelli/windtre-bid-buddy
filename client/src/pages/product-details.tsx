import { useParams } from "wouter";
import { useProduct, usePlaceBid } from "@/hooks/use-products";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Timer, ShieldCheck, User as UserIcon } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";

const bidSchema = z.object({
  amount: z.coerce.number().min(1, "Bid amount is required"),
});

export default function ProductDetails() {
  const { id } = useParams();
  const { data: product, isLoading: isLoadingProduct } = useProduct(Number(id));
  const { user } = useAuth();
  const { toast } = useToast();
  const placeBid = usePlaceBid();

  const form = useForm<z.infer<typeof bidSchema>>({
    resolver: zodResolver(bidSchema),
    defaultValues: {
      amount: 0,
    },
  });

  if (isLoadingProduct) {
    return (
      <Layout>
        <div className="flex h-[80vh] items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!product) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Product Not Found</h1>
          <p className="text-gray-500 mb-6">This auction may have ended or been removed.</p>
          <Link href="/">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const minBid = (product.currentPrice / 100) + 1.00; // Minimum €1 increment

  function onSubmit(values: z.infer<typeof bidSchema>) {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to place a bid.",
        variant: "destructive",
      });
      return;
    }

    const amountInCents = Math.round(values.amount * 100);
    
    if (amountInCents <= product!.currentPrice) {
      form.setError("amount", {
        message: `Bid must be higher than €${(product!.currentPrice / 100).toFixed(2)}`,
      });
      return;
    }

    placeBid.mutate({ productId: product!.id, amount: amountInCents }, {
      onSuccess: () => {
        toast({
          title: "Bid Placed!",
          description: `You successfully bid €${values.amount.toFixed(2)}`,
        });
        form.reset();
      },
      onError: (err) => {
        toast({
          title: "Error",
          description: err.message,
          variant: "destructive",
        });
      },
    });
  }

  return (
    <Layout>
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" className="pl-0 hover:pl-2 transition-all text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Auctions
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Left: Image Gallery */}
        <div className="space-y-6">
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl bg-white border border-gray-100">
            <img 
              src={product.imageUrl} 
              alt={product.title} 
              className="w-full h-full object-cover"
            />
            <div className="absolute top-4 left-4">
              <Badge className="bg-primary/90 hover:bg-primary backdrop-blur-sm text-white px-3 py-1 shadow-lg border-none">
                Live Auction
              </Badge>
            </div>
          </div>
          
          <div className="bg-blue-50/50 rounded-xl p-6 border border-blue-100">
            <div className="flex items-start gap-4">
              <div className="bg-blue-100 p-3 rounded-lg text-blue-600">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-semibold text-blue-900 mb-1">Buyer Protection Guarantee</h4>
                <p className="text-sm text-blue-700/80 leading-relaxed">
                  Your purchase is protected. If the item you receive is not as described, 
                  we'll refund your full purchase price including shipping costs.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Details & Bidding */}
        <div className="space-y-8">
          <div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-gray-900 mb-4 leading-tight">
              {product.title}
            </h1>
            <p className="text-gray-600 text-lg leading-relaxed">
              {product.description}
            </p>
          </div>

          <Card className="border-none shadow-xl ring-1 ring-gray-100 overflow-hidden">
            <div className="bg-[#1D2338] p-6 text-white flex items-center justify-between">
              <div>
                <p className="text-blue-200 text-sm font-medium mb-1 uppercase tracking-wider">Current Highest Bid</p>
                <div className="font-display font-bold text-4xl">
                  €{(product.currentPrice / 100).toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <p className="text-blue-200 text-sm font-medium mb-1 uppercase tracking-wider">Time Remaining</p>
                <div className="flex items-center gap-2 font-mono text-xl font-bold bg-white/10 px-3 py-1 rounded-lg border border-white/10">
                  <Timer className="w-4 h-4 text-primary" />
                  {formatDistanceToNow(new Date(product.endsAt))}
                </div>
              </div>
            </div>

            <CardContent className="p-6 md:p-8 bg-white">
              <div className="space-y-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="flex flex-col md:flex-row gap-4">
                      <FormField
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">€</span>
                                <Input 
                                  type="number" 
                                  step="0.01"
                                  min={minBid}
                                  placeholder={minBid.toFixed(2)}
                                  className="pl-8 h-12 text-lg font-medium" 
                                  {...field} 
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        size="lg" 
                        disabled={placeBid.isPending}
                        className="h-12 px-8 font-semibold text-lg bg-primary hover:bg-orange-600 shadow-lg shadow-orange-500/20"
                      >
                        {placeBid.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Bidding...</>
                        ) : (
                          "Place Bid"
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 text-center">
                      Enter €{minBid.toFixed(2)} or more to bid
                    </p>
                  </form>
                </Form>
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-gray-400" />
                  Bid History ({product.bids.length} bids)
                </h3>
                
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {product.bids.length === 0 ? (
                    <p className="text-gray-500 text-sm italic">No bids yet. Be the first!</p>
                  ) : (
                    product.bids.sort((a, b) => b.amount - a.amount).map((bid) => (
                      <div key={bid.id} className="flex items-center justify-between py-3 px-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 border border-white shadow-sm">
                            <AvatarImage src={bid.bidder.avatarUrl || ""} />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {bid.bidder.username.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm text-gray-900">{bid.bidder.username}</p>
                            <p className="text-xs text-gray-400">{format(new Date(bid.createdAt!), 'MMM d, h:mm a')}</p>
                          </div>
                        </div>
                        <div className="font-bold text-gray-900">
                          €{(bid.amount / 100).toFixed(2)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
