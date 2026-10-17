import { MessageCard } from "@/components/pay/states";

export default function PayNotFound() {
  return <MessageCard title="Can't find this Tab" body="The link might be cut off, ask the sender for it again" />;
}
