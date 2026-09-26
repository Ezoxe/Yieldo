from typing import Literal

from pydantic import BaseModel


class InstanceSettingsOut(BaseModel):
    registration_open: bool
    # "environment" until the administrator first decides: the value then
    # comes from YIELDO_REGISTRATION_OPEN.
    source: Literal["instance", "environment"]


class InstanceSettingsPatch(BaseModel):
    registration_open: bool


class RegistrationStatusOut(BaseModel):
    open: bool
    first_account: bool
