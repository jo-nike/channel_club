"""First-run setup models."""

from typing import Literal

# unclaimed: nobody has set up the club yet, and the first visitor to /setup
# becomes the admin. claimed: the admin exists and is still in the wizard.
# complete: setup is done, or auth comes from the environment.
SetupState = Literal["unclaimed", "claimed", "complete"]
