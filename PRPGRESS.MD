1. Admin Dashboard
   Customer Section :
   Customer profile view and manage:
   Custmer SUbscription view and manage
   Customer Products view and manage
   Customer Orders view and manage
   Customer Payments view and manage

Subscriptions Section:
Manage all subscriptions
Create rules for all subscriptions
handle global level subscription data: like meals type - veg, non-veg, egg

Shop products management:
product purchased list along with delivery info
product management
inventory

2. Customer Dashboard
   Need to have a support button, help button which will redirect them to WA.
3. Rider Dashboard
   Rider Section:
   handle failed delivery;
   Check mark of the product OR meals at delivery
   on rider home, show list of the meals or products
4. Implement the notification system

thats fine as of now for the customer. now we will go ahead and work on the some of the missing and additonal parts of the subscription.
So in existing subscription this is what happening as below:

1. subscription model is working on customer dashboard. where I have shown the 3 subscription plans , which are stored in database table : subscription_plans.
2. customer can purchase the subscription and while purchasing the subscription, he can customize the things like - start date for the subscription( table subscription_plans) daily meal preference, pause dates, delivery address selection for each day (table subscription_daily_preferences), and then customer can purchase the subscription.
3. As of now system is created to have only one subscription for one customer.

I wanted to make below changes:
I want that customer can purchase more than one subscriptions while one subscription is active. so by default the next subscription will start after the expiry of the current subscription. So once current subscription expired then it will have status as expired and expired date, there will be maximum only one subscription Active, and remaining all which are purchased while existing active subscription all go in pending in queue, like one finished the nstart another like wise. So customer can only manage the start and start date of the pending subscrription. I mean they can shift start date to any date, like after expiry of subscription immidiatly or after few days of the expiry of subscription. BUt we wont give upfront option to shift the dates for pending subscription to customer, we will provide options to admin to do that. But we should create a system in database which make this thnigs flexible.
------------------------------------------

1. on customer dashboard we will create a section where admin will subscription for the customer and by default it will be pending .later he can mark pending to active. 
2. while creating new sub , only input start date, end date, days will auto calculate, selecte which subscription it belongs to, it should be belongs to some customer created sub. and activate and as soon as activated manual billing should generate, invoice in billing section.
3. New customer creation should be there on customer navigation menu. 
4. Address management should be there from admin end. 
5. Billing will show all the bills related to specific customer.

