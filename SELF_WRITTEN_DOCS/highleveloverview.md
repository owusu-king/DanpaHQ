ACCOUNTS
One user has one account.
One account has one identity.
A user may have zero, one, or multiple roles.
Tenant and Provider are independent roles.
Welcome selection expresses intent, not authorization.
Phone verification and identity verification are separate.
Role onboarding is separate from identity verification.
Existing users reuse verified/profile information when acquiring another role.
Provider verification is independent of property verification.
A provider must meet the required provider status before creating/activating properties.
Each property is independently verified.
Units do not require independent verification.
Provider suspension does not delete the provider's properties or historical records.
Tenant and Provider spaces are experiences, not separate accounts.
A user with both roles can switch between Tenant and Provider experiences.
Backend authorization is always based on role/status, never the Welcome-page selection.


in provider onboarding, 
Before provider verification

They can:
complete onboarding
view verification status
correct information
respond to requests for information

They cannot create active/listed properties.
Suppose:

Provider = VERIFIED
Property A = VERIFIED
Property B = VERIFIED

Then the provider becomes:

Provider = SUSPENDED

What happens to their properties?

You need a policy.

I recommend:

Provider suspended
       ↓
Existing properties remain records
       ↓
Properties become restricted/inactive
       ↓
Units cannot be newly activated/listed
       ↓
Existing tenant relationships follow separate rules

Don't delete properties simply because provider status changes.

This is especially important once you later build tenant operations
6. Property ownership/management authority is still a separate question

Your provider verification should establish:

"This person/business is allowed to operate as a provider."

Property verification should establish:

"This particular property is legitimate and this provider is authorized to represent/manage it."

That means property verification may need to establish relationship to the property, even though you deliberately don't collect property documents during provider onboardin

Then property type is completely separate

A verified provider can create different property types.

i am done with account and want to work on the property flow, from property creation to joining tenants.



this is what i am going to do.



a landord can create property, the property type must be selected in this 

INDIVIDUAL_OWNER = "individual_owner", "Individual property owner"

    PROPERTY_COMPANY = "property_company", "Property company"

    PROPERTY_MANAGER = "property_manager", "Property management company"

    HOSTEL_OPERATOR = "hostel_operator", "Student hostel operator"



and then we can add a unit to a property.  unit shuld be like



    APARTMENT = "apartment", "Apartment / Flat"

    HOUSE = "house", "House"

    VILLA = "villa", "Villa"

    STUDIO = "studio", "Studio"

    OFFICE = "office", "Office"

    SHOP = "shop", "Shop"

    WAREHOUSE = "warehouse", "Warehouse"

    LAND = "land", "Land"

  

for a hostel operation, we can add room, and even bed. whatever. 

you can correct me where i am wrong.



a provider can then create property, when their account is verified, and submit the property for verification. after it is verified, they can possibly make it public, leave it private and invite tenants to join, by generating code that



property must ask for rooms/units, photos, 3 differnt photos, each meeting specification, like property front, side,  broader view of environment. then creating units for a property only after the property is verified. for unit creation, they will submit 3 photos as well, room view, kitchen, and washroom. this will depend whether the unit has some features. so every feature listed like washroom, must have a pic of washroom, 2 bedrooms, mush have pictures of the two bedroom, kitchen, must have a picture of the kitchen. then they can submit the unit for verification.



if the unit is a shop, require 2 photos of front face, and area view.



if the property is a hostel, then we will require the distance to campus, photo of environment, and room, and beds.



after a unit is created, and verified, the provider can set it to public or keep it private. then they can generate a code for the unit that can be given to tenants to join. once joined, that code expires.



tenant can then have a chat with landlord through the app. this is a feature i will consider later.



a provider will generate a lease agreement so when a tenant wants to join, they can input the code, see the lease, accept or sign and we keep the lease between them.



with public properties, an explorer or tenant can view and send joining request, when the provider accepts the request, ....



this is the property creation and renting workflow for now bu it's hard drafting it. help me draft it





