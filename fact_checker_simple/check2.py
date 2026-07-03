import json  
from langchain_groq import ChatGroq  
from prompts import get_active_prompt  
llm = ChatGroq(model='llama-3.3-70b-versatile', temperature=0.1)  
prompt = get_active_prompt('claim_extraction').format(article_text='Elon Musk becomes the world\'s first trillionaire', max_claims=5)  
res = llm.invoke(prompt)  
print(res.content)  
