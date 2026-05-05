"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { motion } from "framer-motion"
import {
  LayoutDashboard,
  Users,
  BarChart3,
  MessageSquare,
  Phone,
  Calendar,
  Shield,
  Zap,
  Globe,
  CheckCircle2,
  ArrowRight,
  Star,
  ChevronRight,
  Mail,
  Car,
  Building2,
  TrendingUp,
  Clock,
  Bell,
  Target,
  Sparkles,
  Menu,
  X,
  MessageCircle,
  PhoneCall,
  Headphones,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
}

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
}

const WHATSAPP_NUMBER = "+14709099027"
const WHATSAPP_MESSAGE = "Hi! I'm interested in learning more about TikunCRM for my dealership."

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  const openWhatsApp = () => {
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`
    window.open(url, "_blank")
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold">TikunCRM</span>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
              <a href="#testimonials" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Testimonials</a>
              <a href="#contact" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Button variant="ghost" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button onClick={openWhatsApp} className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Contact Us
              </Button>
            </div>

            {/* Mobile menu button */}
            <button 
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border bg-background"
          >
            <div className="px-4 py-4 space-y-3">
              <a href="#features" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#how-it-works" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
              <a href="#testimonials" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>Testimonials</a>
              <a href="#contact" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>Contact</a>
              <div className="pt-3 flex flex-col gap-2">
                <Button variant="outline" asChild className="w-full">
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button onClick={openWhatsApp} className="w-full gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Contact Us
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-3xl opacity-20" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6"
            >
              <Sparkles className="h-4 w-4" />
              <span>Trusted by 10+ Dealerships Across the Region</span>
            </motion.div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
              The Modern CRM Built for{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60">
                Automotive Excellence
              </span>
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Transform your dealership with intelligent lead management, real-time analytics, 
              and seamless multi-channel communication. Close more deals, faster.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <Button size="xl" onClick={openWhatsApp} className="w-full sm:w-auto shadow-lg shadow-primary/25 gap-2">
                <MessageCircle className="h-5 w-5" />
                Message Us on WhatsApp
              </Button>
              <Button size="xl" variant="outline" className="w-full sm:w-auto group" asChild>
                <a href="#contact">
                  <Calendar className="mr-2 h-5 w-5 group-hover:text-primary transition-colors" />
                  Schedule a Demo
                </a>
              </Button>
            </div>

            {/* Stats */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-3 gap-8 max-w-lg mx-auto"
            >
              {[
                { value: "5,000+", label: "Leads Managed" },
                { value: "32%", label: "More Conversions" },
                { value: "99.9%", label: "Uptime SLA" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-primary">{stat.value}</div>
                  <div className="text-xs sm:text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Hero Image - Using provided dashboard screenshot */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.7 }}
            className="mt-16 relative"
          >
            <div className="relative mx-auto max-w-5xl">
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 rounded-2xl blur-2xl opacity-50" />
              <div className="relative rounded-xl border bg-card shadow-2xl overflow-hidden">
                <Image
                  src="/dashboard-preview.png"
                  alt="TikunCRM Dashboard"
                  width={1600}
                  height={900}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trusted By Section */}
      <section className="py-12 border-y border-border/50 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-medium text-muted-foreground mb-8">
            TRUSTED BY LEADING DEALERSHIPS
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-60">
            {[
              "AutoMax Motors",
              "Elite Car Sales",
              "Premier Auto Group",
              "City Motors",
              "Valley Auto",
              "Sunrise Dealership",
              "Metro Cars",
              "Golden State Auto",
              "Pacific Motors",
              "Liberty Auto Sales"
            ].map((company) => (
              <div key={company} className="flex items-center gap-2 text-lg font-semibold text-muted-foreground">
                <Car className="h-5 w-5" />
                {company}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={staggerContainer}
            className="text-center mb-16"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Zap className="h-4 w-4" />
              <span>Powerful Features</span>
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl font-bold mb-4">
              Everything You Need to Close More Deals
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From lead capture to deal closure, TikunCRM provides all the tools 
              your team needs to succeed in today&apos;s competitive market.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Users,
                title: "Smart Lead Management",
                description: "Automatically score, assign, and prioritize leads based on engagement and buying signals.",
                color: "blue" as const
              },
              {
                icon: MessageSquare,
                title: "Omnichannel Communication",
                description: "Engage customers via WhatsApp, SMS, email, and calls from a unified inbox.",
                color: "emerald" as const
              },
              {
                icon: BarChart3,
                title: "Real-Time Analytics",
                description: "Track performance metrics, conversion rates, and team productivity in real-time.",
                color: "purple" as const
              },
              {
                icon: Phone,
                title: "Built-in Softphone",
                description: "Make and receive calls directly from the CRM with automatic call logging.",
                color: "amber" as const
              },
              {
                icon: Calendar,
                title: "Appointment Scheduling",
                description: "Schedule test drives and showroom visits with automated reminders.",
                color: "rose" as const
              },
              {
                icon: Building2,
                title: "Multi-Dealership Support",
                description: "Manage multiple locations with role-based access and centralized reporting.",
                color: "blue" as const
              },
              {
                icon: Bell,
                title: "Smart Notifications",
                description: "Never miss a follow-up with intelligent alerts and task reminders.",
                color: "emerald" as const
              },
              {
                icon: Target,
                title: "SKATE Scoring",
                description: "Proprietary lead scoring algorithm to identify hot prospects instantly.",
                color: "purple" as const
              },
              {
                icon: Shield,
                title: "Enterprise Security",
                description: "Bank-grade encryption, SSO support, and compliance with industry standards.",
                color: "amber" as const
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="h-full hover:shadow-lg transition-all duration-300 hover:border-primary/50 group">
                  <CardContent className="p-6">
                    <div className={cn(
                      "inline-flex p-3 rounded-lg mb-4",
                      feature.color === "blue" && "bg-blue-500/10 text-blue-500",
                      feature.color === "emerald" && "bg-emerald-500/10 text-emerald-500",
                      feature.color === "purple" && "bg-purple-500/10 text-purple-500",
                      feature.color === "amber" && "bg-amber-500/10 text-amber-500",
                      feature.color === "rose" && "bg-rose-500/10 text-rose-500",
                    )}>
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">{feature.title}</h3>
                    <p className="text-muted-foreground text-sm">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 lg:py-32 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={staggerContainer}
            className="text-center mb-16"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Globe className="h-4 w-4" />
              <span>Simple Process</span>
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl font-bold mb-4">
              Get Started in Minutes
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our streamlined onboarding process gets your team up and running quickly.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {[
              {
                step: "01",
                title: "Schedule a Demo",
                description: "Contact us via WhatsApp or schedule a call. We'll understand your needs and show you TikunCRM in action.",
                icon: PhoneCall
              },
              {
                step: "02",
                title: "Custom Setup",
                description: "Our team configures TikunCRM for your dealership, imports your leads, and trains your staff.",
                icon: Building2
              },
              {
                step: "03",
                title: "Start Closing Deals",
                description: "Your team immediately starts managing leads, scheduling appointments, and tracking progress.",
                icon: TrendingUp
              },
            ].map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="relative"
              >
                {index < 2 && (
                  <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
                )}
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-primary/10 mb-6 relative">
                    <item.icon className="h-10 w-10 text-primary" />
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                      {item.step}
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: "10+", label: "Active Dealerships" },
              { value: "5,000+", label: "Leads Processed" },
              { value: "32%", label: "Avg. Conversion Lift" },
              { value: "24/7", label: "Support Available" },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center"
              >
                <div className="text-4xl sm:text-5xl font-bold mb-2">{stat.value}</div>
                <div className="text-primary-foreground/80">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={staggerContainer}
            className="text-center mb-16"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Star className="h-4 w-4" />
              <span>Customer Stories</span>
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl font-bold mb-4">
              What Our Clients Say
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Hear from dealerships that have transformed their sales process with TikunCRM.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                quote: "Before TikunCRM, we were losing leads left and right. Now every inquiry gets followed up within minutes. Our team finally has a system that keeps everyone accountable.",
                author: "Roberto Martinez",
                role: "Sales Manager",
                company: "Metro Cars",
                initials: "RM"
              },
              {
                quote: "The WhatsApp integration is exactly what we needed. Most of our customers prefer messaging over calls, and now we can manage everything from one place without switching apps.",
                author: "Jennifer Adams",
                role: "General Manager",
                company: "Premier Auto Group",
                initials: "JA"
              },
              {
                quote: "We tried three other CRMs before finding TikunCRM. The difference is night and day - it's actually built for how car dealerships work, not just a generic tool.",
                author: "Marcus Thompson",
                role: "Owner",
                company: "Golden State Auto",
                initials: "MT"
              },
            ].map((testimonial, index) => (
              <motion.div
                key={testimonial.author}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
              >
                <Card className="h-full">
                  <CardContent className="p-6">
                    <div className="flex gap-1 mb-4">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="text-foreground mb-6">&ldquo;{testimonial.quote}&rdquo;</p>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                        {testimonial.initials}
                      </div>
                      <div>
                        <div className="font-semibold">{testimonial.author}</div>
                        <div className="text-sm text-muted-foreground">{testimonial.role}, {testimonial.company}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / CTA Section */}
      <section id="contact" className="py-20 lg:py-32 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-3xl overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary/80" />
            <div className="absolute inset-0 bg-[url('/dashboard-preview.png')] bg-cover bg-center mix-blend-overlay opacity-10" />
            <div className="relative px-8 py-16 sm:px-16 sm:py-24 text-center">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground mb-6">
                Ready to Transform Your Sales?
              </h2>
              <p className="text-lg text-primary-foreground/80 max-w-2xl mx-auto mb-8">
                Join the growing number of dealerships using TikunCRM to close more deals 
                and deliver exceptional customer experiences.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                <Button size="xl" variant="secondary" onClick={openWhatsApp} className="w-full sm:w-auto gap-2">
                  <MessageCircle className="h-5 w-5" />
                  WhatsApp Us Now
                </Button>
                <Button 
                  size="xl" 
                  variant="outline" 
                  className="w-full sm:w-auto bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 gap-2"
                  asChild
                >
                  <a href="tel:+14709099027">
                    <PhoneCall className="h-5 w-5" />
                    Call +1 (470) 909-9027
                  </a>
                </Button>
              </div>
              <p className="text-sm text-primary-foreground/60">
                We typically respond within a few hours during business hours.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Why Choose Us Section */}
      <section className="py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <Headphones className="h-4 w-4" />
                <span>Dedicated Support</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                Why Dealerships Choose TikunCRM
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                We&apos;re not just another CRM provider. We&apos;re your partner in building a more efficient, profitable dealership.
              </p>
              <div className="space-y-4">
                {[
                  "Purpose-built for automotive sales workflows",
                  "Personal onboarding and training included",
                  "WhatsApp, SMS, email, and calls in one inbox",
                  "Real humans available for support, not just chatbots",
                  "Continuous updates based on dealer feedback",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-2xl blur-xl" />
              <Card className="relative overflow-hidden">
                <CardContent className="p-8">
                  <div className="text-center">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                      <MessageCircle className="h-10 w-10 text-primary" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Get in Touch</h3>
                    <p className="text-muted-foreground mb-6">
                      Send us a message on WhatsApp and we&apos;ll get back to you shortly.
                    </p>
                    <div className="space-y-3">
                      <Button size="lg" onClick={openWhatsApp} className="w-full gap-2">
                        <MessageCircle className="h-5 w-5" />
                        Message on WhatsApp
                      </Button>
                      <Button size="lg" variant="outline" className="w-full gap-2" asChild>
                        <a href="tel:+14709099027">
                          <Phone className="h-5 w-5" />
                          +1 (470) 909-9027
                        </a>
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-4">
                      Available Monday - Saturday, 9 AM - 6 PM EST
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LayoutDashboard className="h-5 w-5" />
                </div>
                <span className="text-xl font-bold">TikunCRM</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                The modern CRM built for automotive excellence.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a></li>
                <li><a href="#testimonials" className="hover:text-foreground transition-colors">Testimonials</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">About Us</a></li>
                <li><a href="#contact" className="hover:text-foreground transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  <a href="tel:+14709099027" className="hover:text-foreground transition-colors">+1 (470) 909-9027</a>
                </li>
                <li className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  <button onClick={openWhatsApp} className="hover:text-foreground transition-colors">WhatsApp</button>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <a href="mailto:hello@tikuncrm.com" className="hover:text-foreground transition-colors">hello@tikuncrm.com</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} TikunCRM. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 1, type: "spring" }}
        onClick={openWhatsApp}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl hover:scale-110 transition-all flex items-center justify-center"
        aria-label="Contact us on WhatsApp"
      >
        <MessageCircle className="h-7 w-7" />
      </motion.button>
    </div>
  )
}
