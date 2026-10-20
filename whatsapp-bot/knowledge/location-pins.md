# Map pins (seller, rider, buyer)

A pin is a real coordinate, not an address. Delivery pricing measures between
pins, and the rider's delivery check compares their GPS against the buyer's.

## Sellers — required

Asked for during signup, on the site and in chat. It is where riders come to
collect, and it is one end of every delivery price from that shop. A shop
cannot be created without one.

If a seller's phone will not share a location, the Seller Hub has a map they
can tap instead: https://sokonimall.com/suppliers/list.html

Sellers who signed up before pins existed still work, but every delivery from
them prices at the KES 400 minimum until they set one. If a seller asks why
their deliveries all cost the same, this is why.

## Riders — optional

Asked for at the stage step. It decides which jobs reach them: offers go to
the riders nearest the pickup first. Without one, Sokoni falls back to their
live location or the stage name, which is less accurate — so a rider without a
pin sees fewer nearby jobs, but is not blocked from riding.

## Buyers — per order

Asked for at the delivery step. It sets the fee and it is what the rider's
phone is checked against at the door. A buyer can still type a county and town
instead; the order goes through either way, but a pin is better for both.

## How to send one on WhatsApp

Attach (paperclip) then Location, then "Send your current location". Stand
where the pin should be before sending.

## Pins that are refused

A pin reading 0,0, one with latitude and longitude swapped, or anywhere
outside Kenya is rejected rather than saved. A wrong pin is worse than none:
it produces a confident wrong price and can lock a rider out of a delivery
they are standing at. If someone's pin is refused, ask them to turn location
on and send it again.
