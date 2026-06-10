# Product Overview

## ArogyaDiet - Subscription Meal Delivery Platform

ArogyaDiet is a comprehensive subscription-based meal delivery SaaS platform that manages the entire lifecycle from customer orders to kitchen operations and rider deliveries.

### Core Business Model
- **Subscription-based**: Customers subscribe to meal plans with flexible daily delivery preferences
- **Multi-portal system**: Separate interfaces for customers, delivery riders, admins, and super-admins
- **Pincode-based service areas**: Riders are assigned to specific geographic pincodes (not zones)

### Key Features
- **Customer Management**: Subscription lifecycle, daily meal preferences, address management, pause/resume functionality
- **Kitchen Operations**: Meal planning, inventory management, daily order dispatch
- **Delivery Management**: Rider route optimization, real-time tracking, distance-based payouts
- **Administrative Tools**: Customer support, operations monitoring, system configuration

### Critical Business Rules
- **Pause Credits System**: Customers can pause deliveries, which extends subscription end dates
- **Dynamic Addressing**: Customers can change delivery address on a per-day basis
- **Distance-based Payouts**: Rider compensation calculated using Haversine distance * 1.3 multiplier
- **Subscription Integrity**: Pause credits must always match paused days in daily preferences