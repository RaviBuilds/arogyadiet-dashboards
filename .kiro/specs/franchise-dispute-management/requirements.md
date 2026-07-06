# Requirements Document

## Introduction

The Franchise Dispute Management feature enables franchise owners to raise disputes directly from their franchise portal dashboard, and master admins to review and resolve those disputes from the master portal. Disputes follow a one-directional flow from franchise to master admin, supporting categories like Inventory, Customer, Subscriptions, KIT, Rider, Shop Products, Operations, and Others. For inventory-related disputes, franchise owners can link multiple recently received stock transfer orders.

## Glossary

- **Dispute_System**: The dispute management subsystem encompassing the database table, server actions, and UI components across franchise and master portals
- **Franchise_Portal**: The franchise admin dashboard application served at `franchies.localhost:3000` for the FRANCHISE_ADMIN role
- **Master_Portal**: The master admin dashboard application served at `master.localhost:3000` for the MASTER_ADMIN role
- **Franchise_Owner**: A user with the FRANCHISE_ADMIN role who manages a single franchise
- **Master_Admin**: A user with the MASTER_ADMIN role who oversees all franchises
- **Dispute**: A record raised by a Franchise_Owner to report an issue, tracked through a status lifecycle
- **Dispute_Status**: The lifecycle state of a Dispute — one of Open, Under_Investigation, or Solved
- **Dispute_Category**: The classification of a Dispute — one of Inventory, Customer, Subscriptions, KIT, Rider, Shop_Products, Operations, or Others
- **Stock_Transfer**: A record in the `franchise_stock_transfers` table representing an inventory shipment to a franchise
- **Received_Order**: A Stock_Transfer with state RECEIVED and received within the last 72 hours relative to the current time

## Requirements

### Requirement 1: Database Schema for Disputes

**User Story:** As a developer, I want a disputes table in the database, so that the system can persist and query dispute records across both portals.

#### Acceptance Criteria

1. THE Dispute_System SHALL store disputes in a `franchise_disputes` table with columns: id (UUID, primary key, default gen_random_uuid()), franchise_id (UUID, NOT NULL, foreign key to franchises), category (text, NOT NULL, one of the Dispute_Category values), description (text, NOT NULL, max 2000 characters), status (text, NOT NULL, default 'Open'), master_admin_comment (text, nullable), related_order_ids (UUID array, nullable), created_at (timestamptz, NOT NULL, default now()), and updated_at (timestamptz, NOT NULL, default now())
2. THE Dispute_System SHALL enforce a foreign key constraint from `franchise_disputes.franchise_id` to `franchises.id`
3. THE Dispute_System SHALL restrict the `category` column via a CHECK constraint to the values: Inventory, Customer, Subscriptions, KIT, Rider, Shop_Products, Operations, Others
4. THE Dispute_System SHALL restrict the `status` column via a CHECK constraint to the values: Open, Under_Investigation, Solved
5. THE Dispute_System SHALL enable Row Level Security on the `franchise_disputes` table
6. THE Dispute_System SHALL apply an RLS SELECT policy so that a FRANCHISE_ADMIN can only read disputes belonging to their own franchise_id
7. THE Dispute_System SHALL apply an RLS INSERT policy so that a FRANCHISE_ADMIN can only insert disputes with their own franchise_id
8. THE Dispute_System SHALL apply an RLS SELECT and UPDATE policy so that a MASTER_ADMIN can read and update all disputes
9. THE Dispute_System SHALL create a trigger to automatically update the `updated_at` column to now() on every UPDATE to a row

### Requirement 2: Franchise Portal Disputes Navigation

**User Story:** As a Franchise_Owner, I want a Disputes button on my dashboard, so that I can quickly access the dispute management page.

#### Acceptance Criteria

1. THE Franchise_Portal SHALL display a "Disputes" button on the franchise dashboard page, visible without scrolling within the primary action area
2. WHEN the Franchise_Owner clicks the "Disputes" button, THE Franchise_Portal SHALL navigate to the `/disputes` route within the franchise portal and display the dispute management page

### Requirement 3: Franchise Dispute History View

**User Story:** As a Franchise_Owner, I want to see a history of my disputes, so that I can track the status and details of previously raised issues.

#### Acceptance Criteria

1. WHEN the Franchise_Owner navigates to the disputes page, THE Franchise_Portal SHALL display a table listing all disputes belonging to the current franchise
2. THE Franchise_Portal SHALL display each dispute row with the following columns: category, description (truncated to a maximum of 100 characters with an ellipsis appended if the full text exceeds 100 characters), status, master admin comment (if present), and creation date
3. THE Franchise_Portal SHALL display the status as a badge with a unique background color per state so that Open, Under_Investigation, and Solved are visually distinguishable from one another
4. THE Franchise_Portal SHALL order disputes by creation date in descending order (newest first)
5. THE Franchise_Portal SHALL only fetch disputes where franchise_id matches the franchise ID from the `x-franchise-id` cookie
6. IF the current franchise has no disputes, THEN THE Franchise_Portal SHALL display an empty-state message indicating that no disputes have been raised yet
7. IF the `x-franchise-id` cookie is missing or does not correspond to a valid franchise, THEN THE Franchise_Portal SHALL prevent data fetching and redirect the user to the login page

### Requirement 4: Raise New Dispute

**User Story:** As a Franchise_Owner, I want to raise a new dispute with a category and description, so that I can report issues to the master admin for resolution.

#### Acceptance Criteria

1. THE Franchise_Portal SHALL provide a form to raise a new dispute containing a category dropdown (with no default selection), a description textarea, and a submit button
2. THE Franchise_Portal SHALL populate the category dropdown with the options: Inventory, Customer, Subscriptions, KIT, Rider, Shop Products, Operations, Others
3. WHEN the Franchise_Owner submits the dispute form with a valid category and description, THE Dispute_System SHALL create a new dispute record with the selected category, entered description, the franchise_id from the `x-franchise-id` cookie, and status set to Open
4. IF the Franchise_Owner attempts to submit the dispute form with no category selected or with a description that is empty or contains only whitespace, THEN THE Franchise_Portal SHALL display an inline validation error below the invalid field and prevent submission
5. THE Franchise_Portal SHALL enforce a maximum description length of 2000 characters and display a character counter below the description textarea
6. WHEN a dispute is successfully created, THE Franchise_Portal SHALL display a success toast notification and refresh the dispute history table
7. IF the dispute creation server action fails, THEN THE Franchise_Portal SHALL display an error toast notification indicating the dispute could not be created and preserve the entered form data

### Requirement 5: Inventory Category Order Selection

**User Story:** As a Franchise_Owner, I want to link received inventory orders to a dispute when reporting inventory issues, so that the master admin has context about which shipments are affected.

#### Acceptance Criteria

1. WHEN the Franchise_Owner selects "Inventory" as the dispute category, THE Franchise_Portal SHALL display a second multi-select dropdown listing Received_Orders
2. THE Franchise_Portal SHALL populate the Received_Orders dropdown with Stock_Transfers where `dest_franchise_id` matches the current franchise_id, `state` equals RECEIVED, and the `received_at` timestamp is within the last 72 hours from the current time
3. THE Franchise_Portal SHALL display each Received_Order option showing the transfer ID, product name, and quantity received
4. WHEN the Franchise_Owner selects one or more Received_Orders and submits the dispute, THE Dispute_System SHALL store the selected order IDs in the `related_order_ids` column of the dispute record
5. WHEN the Franchise_Owner selects a category other than Inventory, THE Franchise_Portal SHALL hide the Received_Orders dropdown and clear any previous selection
6. IF the Franchise_Owner submits an Inventory dispute without selecting at least one Received_Order, THEN THE Franchise_Portal SHALL prevent submission and display an error message indicating that at least one received order must be selected
7. IF no Stock_Transfers matching the filter criteria exist, THEN THE Franchise_Portal SHALL display the Received_Orders dropdown in a disabled state with a message indicating no received orders are available in the last 72 hours

### Requirement 6: Master Portal Disputes Navigation

**User Story:** As a Master_Admin, I want a Manage Disputes button on my dashboard, so that I can access the dispute management interface.

#### Acceptance Criteria

1. THE Master_Portal SHALL display a "Manage Disputes" button on the master admin dashboard page that is visible without scrolling past the page header
2. WHEN the Master_Admin clicks the "Manage Disputes" button, THE Master_Portal SHALL navigate to the `/disputes` route within the master portal and display the disputes management interface within 2 seconds
3. IF the Master_Admin navigates directly to the `/disputes` route without clicking the button, THEN THE Master_Portal SHALL display the same dispute management interface

### Requirement 7: Master Portal Dispute List View

**User Story:** As a Master_Admin, I want to view all disputes from all franchises, so that I can monitor and address franchise issues.

#### Acceptance Criteria

1. WHEN the Master_Admin navigates to the disputes page, THE Master_Portal SHALL display a table listing all disputes across all franchises
2. THE Master_Portal SHALL display each dispute row with the columns: franchise name, category, description (truncated to a maximum of 100 characters with an ellipsis appended if the original exceeds 100 characters), status, master admin comment (if present), related order count (if present), and creation date
3. THE Master_Portal SHALL order disputes by creation date in descending order (newest first)
4. THE Master_Portal SHALL provide a franchise filter dropdown populated with an "All Franchises" default option followed by all franchises that have at least one dispute
5. WHEN the Master_Admin selects a franchise from the filter dropdown, THE Master_Portal SHALL display only disputes belonging to the selected franchise
6. WHEN the Master_Admin selects the "All Franchises" option from the filter dropdown, THE Master_Portal SHALL display disputes from all franchises
7. IF no disputes exist matching the current filter selection, THEN THE Master_Portal SHALL display an empty state message indicating that no disputes were found

### Requirement 8: Master Admin Dispute Resolution

**User Story:** As a Master_Admin, I want to update dispute statuses and add comments, so that I can communicate investigation progress and resolution to franchise owners.

#### Acceptance Criteria

1. THE Master_Portal SHALL provide controls on each dispute row to update the dispute status, showing only the valid next status as an available action (Under_Investigation for Open disputes, Solved for Under_Investigation disputes)
2. WHEN the Master_Admin marks a dispute as Under_Investigation, THE Dispute_System SHALL require the Master_Admin to provide a comment between 10 and 1000 characters and update the status to Under_Investigation along with the comment in `master_admin_comment`
3. WHEN the Master_Admin marks a dispute as Solved, THE Dispute_System SHALL require the Master_Admin to provide a comment between 10 and 1000 characters and update the status to Solved along with the comment in `master_admin_comment`
4. IF the Master_Admin attempts a status transition that is not Open to Under_Investigation or Under_Investigation to Solved, THEN THE Dispute_System SHALL reject the update and display an error message indicating the transition is not permitted
5. WHEN a dispute status is updated, THE Master_Portal SHALL update the `updated_at` timestamp on the dispute record
6. WHEN a dispute status is successfully updated, THE Master_Portal SHALL display a success confirmation for 5 seconds and refresh the dispute list to reflect the new status
7. IF the dispute status update fails due to a server or network error, THEN THE Dispute_System SHALL display an error message indicating the failure reason and preserve the Master_Admin's entered comment so it is not lost

### Requirement 9: Dispute Access Control

**User Story:** As a system operator, I want disputes to be accessible only to authorized roles, so that sensitive franchise information remains protected.

#### Acceptance Criteria

1. IF a user without the FRANCHISE_ADMIN role attempts to create a dispute, THEN THE Dispute_System SHALL reject the request and return an error indicating insufficient permissions without creating the dispute
2. IF a user without the MASTER_ADMIN role attempts to update dispute status or comments, THEN THE Dispute_System SHALL reject the request and return an error indicating insufficient permissions without modifying the dispute
3. THE Dispute_System SHALL restrict FRANCHISE_ADMIN users to viewing only disputes where franchise_id matches their own franchise
4. WHILE a user holds the MASTER_ADMIN role, THE Dispute_System SHALL display all disputes across all franchises without franchise_id filtering
5. IF an unauthenticated user attempts to access the disputes page on the franchise portal or master portal, THEN THE Dispute_System SHALL redirect the user to the login page of the respective portal
6. THE Dispute_System SHALL use the `createAdminClient` for dispute mutations and `createClient` from `@/lib/supabase/server` for dispute reads
