# Trying the demo

This isn't real authentication - just type in an employee ID and name
from the table below, pick the matching role, and you're in. Every value
below is a real row from the underlying employee data, not made up.

## Employee

| Employee ID | Full name |
|---|---|
| EMP052 | Eddy Employee |
| EMP001 | John Doe |
| EMP011 | Richard Thomas |
| EMP029 | Donald Lopez |

## Manager

| Employee ID | Full name |
|---|---|
| EMP053 | Mia Manager |
| MGR001 | Alice Johnson |
| MGR002 | Bob Smith |

## HR Support

| Employee ID | Full name |
|---|---|
| EMP051 | Hana Support |
| EMP021 | Daniel Rodriguez |
| EMP022 | Jessica Lewis |

## Admin

There's also an Admin role, for reviewing conversations, feedback, and
leave requests from an HR-ops angle. It needs a secret code on top of
the ID/name, and that code isn't published anywhere - so you can see
that this role exists, but you can't actually log in as it from here.
If you want a walkthrough of what it looks like, ask me directly.

(There's a separate, broader DevOps/engineering-admin role too, with
access to the full build/deploy/architecture side of things - not
covered in this guide, not meant for a demo visitor.)

## The full list

The above is a short sample. The complete roster, with the real
department each person belongs to, is in
[hrb_chatbot_service's KNOWN-PERSONAS.md](https://github.com/rvsree/hrb_chatbot_service/blob/master/docs/agent-reference/KNOWN-PERSONAS.md).
