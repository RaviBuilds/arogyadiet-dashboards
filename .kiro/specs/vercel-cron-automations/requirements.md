# Requirements Document

## Introduction

This feature configures Vercel Cron Jobs for three existing automation scripts in the ArogyaDiet subscription meal delivery platform. The automations currently run manually from the admin Operations page via "Run Script" buttons. This feature adds scheduled cron execution through Vercel's native cron infrastructure while preserving the existing manual trigger capability unchanged. All schedules use IST (Indian Standard Time, UTC+5:30) and must be converted to UTC cron expressions for Vercel's configuration.

## Glossary

- **Cron_Scheduler**: The Vercel Cron Jobs infrastructure that triggers HTTP GET requests to specified API routes at configured intervals
- **Order_Creation_Automation**: The system process that generates delivery orders from active subscriptions for a target delivery date
- **Product_Linking_Automation**: The system process that attaches paid add-on shop products to planned delivery orders for a target date
- **Routing_Batching_Automation**: The system process that creates rider batches, assigns delivery sequences, and allocates orders to riders for a target date
- **Cron_Route**: A Next.js API route endpoint (under `/api/cron/`) that executes an automation when invoked via HTTP GET with a valid secret
- **CRON_SECRET**: An environment variable used to authenticate cron requests and prevent unauthorized invocation of automation endpoints
- **Manual_Trigger**: The existing admin UI "Run Script" button on the Operations page that invokes the same automation logic via server actions
- **IST**: Indian Standard Time (UTC+5:30), the timezone used for all scheduling logic in this platform
- **Vercel_Config**: The `vercel.json` file at the project root that declares cron job schedules and their target API paths

## Requirements

### Requirement 1: Order Creation Cron Schedule

**User Story:** As a platform operator, I want delivery orders to be generated automatically every day at 5:15 PM IST, so that tomorrow's orders are ready without manual intervention.

#### Acceptance Criteria

1. THE Cron_Scheduler SHALL invoke the Order_Creation_Automation endpoint at 11:45 UTC (equivalent to 5:15 PM IST) every day
2. WHEN the Cron_Scheduler invokes the Order_Creation_Automation endpoint without a valid CRON_SECRET, THE Order_Creation_Automation SHALL reject the request with an unauthorized error and SHALL NOT generate any orders
3. WHEN the Cron_Scheduler invokes the Order_Creation_Automation endpoint with a valid CRON_SECRET, THE Order_Creation_Automation SHALL generate delivery orders for tomorrow's date (calculated in IST) by selecting all active, non-paused subscription daily preferences for that date, skipping any customer-meal combinations that already have a delivery order for the target date
4. WHEN the Order_Creation_Automation completes successfully via cron, THE Order_Creation_Automation SHALL send an admin notification (via email and push) indicating the automation has completed, and SHALL log the run in the automation_logs table with the count of orders inserted and skipped
5. WHEN the Order_Creation_Automation completes successfully via cron and at least one new order was inserted, THE Order_Creation_Automation SHALL send push notifications to each customer for whom a new delivery order was created, informing them of their meal order for tomorrow
6. IF the Order_Creation_Automation encounters a database error or internal failure during order generation, THEN THE Order_Creation_Automation SHALL return an error response with status 500 and SHALL NOT send customer or admin notifications for that run
7. IF the notification delivery fails after successful order generation, THEN THE Order_Creation_Automation SHALL still report the order generation as successful and SHALL NOT roll back inserted orders

### Requirement 2: Product Linking Cron Schedule

**User Story:** As a platform operator, I want paid add-on products to be linked to delivery orders automatically every day at 12:05 AM IST, so that today's deliveries include all purchased add-ons without manual intervention.

#### Acceptance Criteria

1. THE Cron_Scheduler SHALL invoke the Product_Linking_Automation endpoint at 18:35 UTC (equivalent to 12:05 AM IST) every day
2. WHEN the Cron_Scheduler invokes the Product_Linking_Automation endpoint, THE Product_Linking_Automation SHALL associate each addon_order with status "PAID", target_delivery_date equal to today's IST date, and no existing delivery_order_id, to the delivery_order matching the same customer_profile_id and delivery_date with status "ORDER_CREATED"
3. WHEN the Product_Linking_Automation completes successfully via cron, THE Product_Linking_Automation SHALL send an email notification to admins indicating the total count of addon_orders linked in that run
4. IF no delivery orders with status "ORDER_CREATED" exist for today's IST date, THEN THE Product_Linking_Automation SHALL complete successfully and report a linked count of 0
5. IF the Product_Linking_Automation encounters a database error during execution, THEN THE Product_Linking_Automation SHALL return an HTTP 400 response with the error description and not send the admin notification

### Requirement 3: Routing & Batching Cron Schedule

**User Story:** As a platform operator, I want rider batches and delivery sequences to be created automatically every day at 12:10 AM IST, so that today's deliveries are optimally assigned to riders without manual intervention.

#### Acceptance Criteria

1. THE Cron_Scheduler SHALL invoke the Routing_Batching_Automation endpoint at 18:40 UTC (equivalent to 12:10 AM IST) every day
2. WHEN the Cron_Scheduler invokes the Routing_Batching_Automation endpoint, THE Routing_Batching_Automation SHALL create rider batches and assign delivery sequences for today's date and return an HTTP 200 response with batch count and assignment statistics
3. THE Cron_Scheduler SHALL schedule the Routing_Batching_Automation to execute at least 5 minutes after the Product_Linking_Automation (18:40 UTC vs 18:35 UTC) to allow the preceding automation to complete before routing begins
4. IF the Routing_Batching_Automation encounters an error during execution, THEN THE Routing_Batching_Automation SHALL return an HTTP 4xx or 5xx response with an error message indicating the failure reason and SHALL NOT partially persist incomplete batch assignments
5. WHEN the Routing_Batching_Automation completes successfully via cron, THE Routing_Batching_Automation SHALL send admin notifications with the count of rider batches created and orders assigned

### Requirement 4: Cron Authentication

**User Story:** As a platform operator, I want cron endpoints to be secured with a shared secret, so that unauthorized parties cannot trigger automations.

#### Acceptance Criteria

1. WHEN a request arrives at any Cron_Route without a `secret` query parameter, or with a `secret` value that does not exactly match the CRON_SECRET environment variable, THE Cron_Route SHALL return HTTP 401 Unauthorized with a JSON error response and SHALL NOT execute any automation logic or produce side-effects
2. WHEN a request arrives at any Cron_Route with a `secret` query parameter whose value exactly matches the CRON_SECRET environment variable (case-sensitive comparison), THE Cron_Route SHALL authenticate the request and proceed with automation execution
3. THE Vercel_Config SHALL include the CRON_SECRET value as the `secret` query parameter in each cron path definition (e.g., `/api/cron/<name>?secret=<CRON_SECRET_VALUE>`)
4. IF the CRON_SECRET environment variable is not set, THEN THE Cron_Route SHALL reject all requests with HTTP 401 Unauthorized rather than falling back to a default value

### Requirement 5: Manual Trigger Preservation

**User Story:** As an admin, I want to continue using the existing "Run Script" buttons on the Operations page, so that I can run any automation manually at any time regardless of the cron schedule.

#### Acceptance Criteria

1. THE Manual_Trigger for Order_Creation_Automation SHALL remain functional via the `triggerSystemAutomation` server action and invoke the same `generateDailyOrders` function as the cron endpoint
2. THE Manual_Trigger for Product_Linking_Automation SHALL remain functional via the `runProductLinkingAction` server action and invoke the same product linking logic as the cron endpoint
3. THE Manual_Trigger for Routing_Batching_Automation SHALL remain functional via the `triggerSystemAutomation` server action and invoke the same `executeAutomatedDispatch` function as the cron endpoint
4. WHEN an admin triggers an automation manually, THE Manual_Trigger SHALL execute the automation regardless of whether the cron has already run for that day, and the automation_logs run_count SHALL increment accordingly
5. THE existing admin Operations page UI (date pickers, "Run Script" buttons, last-run status) SHALL NOT be modified by this feature

### Requirement 6: Vercel Cron Configuration

**User Story:** As a developer, I want all three cron jobs declared in vercel.json alongside the existing activate-subscriptions cron, so that Vercel deploys and manages all schedules automatically.

#### Acceptance Criteria

1. THE Vercel_Config SHALL declare the Order_Creation_Automation cron with schedule `45 11 * * *` and path `/api/cron/generate-orders`
2. THE Vercel_Config SHALL declare the Product_Linking_Automation cron with schedule `35 18 * * *` and path `/api/cron/link-products`
3. THE Vercel_Config SHALL declare the Routing_Batching_Automation cron with schedule `40 18 * * *` and path `/api/cron/dispatch`
4. THE Vercel_Config SHALL retain the existing activate-subscriptions cron entry with its original path `/api/cron/activate-subscriptions`, schedule `30 8 * * *`, and query parameter unchanged
5. THE Vercel_Config SHALL append a `secret` query parameter to each new cron path in the format `?secret=<CRON_SECRET_value>`, matching the same query parameter name used by the existing activate-subscriptions entry
6. THE Vercel_Config SHALL contain exactly 4 entries in the `crons` array, each entry being an object with a `path` string and a `schedule` string in standard cron expression format

### Requirement 7: Automation Logging

**User Story:** As an admin, I want cron-triggered automations to log their execution results, so that I can review automation history from the Operations page.

#### Acceptance Criteria

1. WHEN any Cron_Route completes execution (success or failure), THE Cron_Route SHALL upsert a record in the automation_logs table keyed by (automation_type, target_date) with the automation type, target date, run count, last_run_at timestamp, and latest_stats JSON containing execution statistics specific to that automation type
2. THE Cron_Route SHALL set run_count to 1 for new entries and increment run_count by 1 for existing entries sharing the same automation_type and target_date combination
3. WHEN reviewing the Automation Logs section on the Operations page, THE admin SHALL see both cron-triggered and manually-triggered automation runs in the same log view, with identical schema and statistics format regardless of trigger source
