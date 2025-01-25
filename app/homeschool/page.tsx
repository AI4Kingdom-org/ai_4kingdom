import Chat from "@/app/chat/Chat";
import { CHAT_TYPES } from "@/app/config/chatTypes";
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from "../config/constants";

export default function Homeschool() {
    return (
            <Chat 
                type= { CHAT_TYPES.HOMESCHOOL }
                assistantId = { ASSISTANT_IDS.HOMESCHOOL }
                vectorStoreId = { VECTOR_STORE_IDS.HOMESCHOOL }
            />
    )
}