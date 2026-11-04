// Deterministic, synthetic publications for offline UI checks. Never a real profile.
(function() {
  const topics=['Prostate MRI','Imaging AI','Interventional radiology','Genitourinary oncology','Ultrasound'];
  const titles=['Multiparametric MRI for prostate cancer detection','Deep learning for lesion segmentation','Image-guided biopsy and treatment outcomes','Imaging biomarkers in renal cell carcinoma','Contrast-enhanced ultrasound in clinical practice'];
  const journals=[['Radiology',17.6],['European Radiology',6],['Korean Journal of Radiology',6.1],['AJR American Journal of Roentgenology',7.4],['Investigative Radiology',7.9],['Clinical Imaging',2.2],['Medical Image Analysis',14],['Synthetic journal with OA metric',3.8]];
  function load(count=180, options={}) {
    const author={id:'fixture-author',display_name:'Publication Explorer · Demo',_institutions:['Synthetic publications for interface preview — not a real researcher']};
    const works=Array.from({length:count},(_,i)=>{
      const topic=i%5,year=options.singleYear?2024:2005+(i*7+Math.floor(i/22))%22;
      const cites=i===0?1317:Math.round(((i*37)%101)/100*(2028-year)*18);
      const focal={author:{id:author.id,display_name:author.display_name}};
      const a={author:{id:'coauthor-'+i%9,display_name:'Demo Coauthor '+i%9}},b={author:{id:'last-'+i%3,display_name:'Demo Last Author '+i%3}};
      return {id:'fixture-'+i,title:titles[topic]+': '+['a multicenter study','prospective validation','long-term follow-up','systematic evaluation'][Math.floor(i/5)%4]+' ('+(i+1)+')',publication_year:year,cited_by_count:cites,
        primary_location:{source:{id:'source-'+i%8,display_name:journals[i%8][0]}},topics:[{display_name:topics[topic]}],
        authorships:i%3===0?[focal,a]:i%3===1?[a,focal]:[a,focal,b],_sources:{openalex:true}};
    });
    if(count>10) {
      works[3].primary_location.source={id:'missing',display_name:'Journal with unknown IF'};
      works[4].primary_location.source={id:'zero',display_name:'Journal with a zero metric'};
      works[5].cited_by_count=null;
      works[6].publication_year=works[7].publication_year;works[6].cited_by_count=works[7].cited_by_count;
      works[6].primary_location=works[7].primary_location;
      works[8].primary_location.source={id:'outlier',display_name:'Synthetic high-IF journal'};
    }
    const stats=new Map(journals.map(([display_name,if_2yr],i)=>['source-'+i,{display_name,if_2yr,if_source:i===7?'OA':'JCR'}]));
    stats.set('zero',{display_name:'Journal with a zero metric',if_2yr:0,if_source:'JCR'});
    stats.set('outlier',{display_name:'Synthetic high-IF journal',if_2yr:80,if_source:'JCR'});
    RKG.state.setAuthor(author);RKG.state.setWorks(works);RKG.state.setSourceStats(stats);RKG.dashboard.activate();
    document.querySelector('[data-tab="bubble3d"]').click();
    document.querySelector('.explorer-heading p').textContent='Synthetic demo · '+count+' publications · Select a paper to explore its details.';
    return {count,works};
  }
  window.explorerFixture={load};
})();
