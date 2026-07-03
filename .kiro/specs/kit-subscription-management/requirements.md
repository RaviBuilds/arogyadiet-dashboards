# Requirements Document

## Introduction

The ArogyaDiet platform currently supports meal subscription customers with recurring delivery schedules. This feature introduces a completely separate KIT subscription category for one-time purchases of ready-to-eat meal packages (e.g., 30-day kits). KIT subscriptions are delivered via courier or picked up from clinic locations, operate independently from the existing meal subscription system, and require dedicated administrative workflows for order fulfillment and shipping management.

## Glossary

- **KIT**: Ready-to-eat meal package sold as a one-time purchase (e.g., 30-day kit)
- **Customer_Category**: Classification of customer type (Meals, KIT, Accommodation)
- **Meal_Subscription**: Existing recurring subscription system for daily meal deliveries
- **Admin_Portal**: Desktop-first operations interface accessible at admin.domain.com
- **Customer_Portal**: Customer-facing interface for subscription management
- **Quick_Onboarding**: Multi-step admin workflow to create new customer subscriptions
- **Serviceable_Area**: PIN code validation system for meal delivery coverage
- **Shipping_Dashboard**: KIT 360 interface for managing courier and tracking information
- **Courier_Partner**: Third-party logistics provider for KIT delivery
- **Tax_Rate**: Fixed 5% tax rate applied to all KIT products

## Requirements

### Requirement 1: KIT Product Management

**User Story:** As an admin, I want to manage KIT products with their pricing, so that I can offer different KIT tiers to customers.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a "KITs" submenu under the Subscriptions navigation menu
2. WHEN the KITs menu is accessed, THE Admin_Portal SHALL display exactly three initial KIT products in card format:
   - Weightloss Platinum - ₹28,080.00
   - Weightloss Premium - ₹19,760.00
   - Weightloss Prime - ₹10,400.00
3. THE Admin_Portal SHALL provide functionality to add new KIT products with name and price fields
4. THE Admin_Portal SHALL store KIT product information separately from meal subscription plans
5. THE Admin_Portal SHALL apply a 5% tax rate to all KIT product prices for invoice generation

### Requirement 2: Quick Onboarding Category Selection

**User Story:** As an admin, I want to select KIT category during customer onboarding, so that I can create KIT customers separately from meal customers.

#### Acceptance Criteria

1. WHEN "Kit" category is selected in Step 2 of Quick_Onboarding, THE Admin_Portal SHALL replace the subscription plan dropdown with a "Kit name" dropdown
2. THE Kit_Name_Dropdown SHALL display all available KIT products with their names and prices
3. WHEN "Kit" category is selected, THE Admin_Portal SHALL display a "Days" text field for manual entry of kit duration
4. THE Admin_Portal SHALL retain meal preference selection (Veg, Egg, Chicken) when Kit category is selected
5. THE Admin_Portal SHALL keep Step 1 (Details) unchanged regardless of category selection

### Requirement 3: Address Validation Bypass for KIT Customers

**User Story:** As an admin, I want to onboard KIT customers from any location, so that I can serve customers outside meal delivery serviceable areas.

#### Acceptance Criteria

1. WHEN a customer with category "Kit" reaches Step 3 (Address) of Quick_Onboarding, THE Admin_Portal SHALL NOT enforce PIN code serviceable area validation
2. THE Admin_Portal SHALL accept any valid Indian PIN code for KIT customers
3. THE Admin_Portal SHALL continue to enforce PIN code validation for Meal_Subscription customers
4. THE Admin_Portal SHALL allow KIT customers to enter addresses outside the current meal delivery coverage areas

### Requirement 4: KIT Payment and Onboarding Completion

**User Story:** As an admin, I want to complete KIT customer onboarding only after payment confirmation, so that unpaid KIT orders are not activated.

#### Acceptance Criteria

1. WHEN Step 4 (Payment & Review) displays for a KIT customer, THE Admin_Portal SHALL show KIT-specific product information including kit name, price, and tax amount
2. THE Admin_Portal SHALL disable the onboarding completion action until payment status is marked as "Paid"
3. WHEN payment is marked as "Paid", THE Admin_Portal SHALL enable the onboarding completion action
4. THE Admin_Portal SHALL create a customer record with Customer_Category set to "KIT" upon completion

### Requirement 5: KIT Customer Identification in Customer List

**User Story:** As an admin, I want to identify KIT customers in the onboarded customers list, so that I can manage them differently from meal customers.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a "Shipping" button adjacent to the "View" button for customers with Customer_Category "KIT"
2. THE Admin_Portal SHALL NOT display the "Shipping" button for customers with Customer_Category "Meals"
3. WHEN the "Shipping" button is clicked, THE Admin_Portal SHALL open the Shipping_Dashboard for that KIT customer

### Requirement 6: Shipping Information Management

**User Story:** As an admin, I want to record shipping details for KIT orders, so that customers can track their package deliveries.

#### Acceptance Criteria

1. WHEN the Shipping_Dashboard opens, THE Admin_Portal SHALL display a form with courier partner dropdown, tracking number field, and conditional URL field
2. THE Courier_Partner_Dropdown SHALL contain exactly these options:
   - Other shipping
   - APSRTC Logistics
   - TGSRTC Logistics
   - DTDC
3. WHEN "Other shipping" is selected, THE Admin_Portal SHALL display an additional URL text field for tracking page link
4. WHEN any other courier partner is selected, THE Admin_Portal SHALL hide the URL field
5. THE Admin_Portal SHALL provide a save action to persist shipping information for the KIT order

### Requirement 7: KIT and Meal Subscription Isolation

**User Story:** As a system administrator, I want KIT subscription logic completely isolated from meal subscription logic, so that changes to one system do not affect the other.

#### Acceptance Criteria

1. THE System SHALL store KIT customer data separately from Meal_Subscription customer data using the Customer_Category discriminator
2. THE System SHALL NOT apply meal subscription business rules (pause credits, daily preferences, delivery batches, rider assignments) to KIT customers
3. THE System SHALL NOT apply KIT business rules (shipping information, courier tracking) to Meal_Subscription customers
4. THE System SHALL maintain three distinct customer categories: Meals, KIT, Accommodation
5. THE System SHALL ensure modifications to meal subscription workflows do not execute for KIT customers

### Requirement 8: Customer Portal KIT Isolation

**User Story:** As a KIT customer, I want to see only KIT-related information in my customer portal, so that I am not confused by meal subscription features.

#### Acceptance Criteria

1. WHEN a customer with Customer_Category "KIT" accesses the Customer_Portal, THE System SHALL display only KIT-specific information
2. THE Customer_Portal SHALL NOT display meal subscription UI elements (daily preferences, pause functionality, delivery schedules) to KIT customers
3. THE Customer_Portal SHALL display shipping status and tracking information for KIT customers
4. THE Customer_Portal SHALL provide a completely isolated experience based on Customer_Category

### Requirement 9: KIT Product Data Persistence

**User Story:** As a developer, I want KIT product information stored in the database, so that the system can manage multiple KIT offerings over time.

#### Acceptance Criteria

1. THE System SHALL persist KIT product data including kit name, base price, and tax rate
2. THE System SHALL associate each KIT customer order with a specific KIT product reference
3. THE System SHALL maintain historical records of KIT products even when new products are added
4. THE System SHALL store shipping information linked to specific KIT customer orders

### Requirement 10: Invoice Generation for KIT Orders

**User Story:** As an admin, I want to generate invoices for KIT orders with correct tax calculations, so that financial records are accurate.

#### Acceptance Criteria

1. WHEN an invoice is generated for a KIT order, THE System SHALL calculate tax amount as KIT product price multiplied by 5%
2. THE System SHALL display the base price, tax amount, and total amount separately on the invoice
3. THE System SHALL include KIT product name and duration (days) in the invoice details
4. THE System SHALL generate invoices only for KIT orders marked as "Paid"
